#!/usr/bin/env node
/**
 * Controlled Interactive Super Admin Password Reset Utility
 * ========================================================
 * Safely updates ONLY the confirmed existing Super Admin account in Supabase:
 *   ID:    d9a494cb-1e8d-4bca-8142-19687fa9138b
 *   Email: admin@inferxe.com
 *
 * Security guarantees:
 * - Prompts for password & confirmation via hidden interactive terminal input.
 * - Restores terminal mode idempotently on normal exit, Ctrl+C, SIGINT, SIGTERM,
 *   stdin error, and stdin end, and ignores ANSI escape sequences.
 * - Enforces Inferxe strong password policy (`validatePasswordStrength`).
 * - Generates a standard Argon2id PHC hash via `hashPassword()`.
 * - Preserves `id`, `email`, `role`, and `is_active` (never creates/deletes accounts).
 * - Increments `session_version` and revokes all existing `admin_sessions`.
 * - Records a non-secret event in `audit_logs` and fails non-zero if revocation or
 *   audit logging fails (never prints full success on partial completion).
 * - Verifies that strictly 1 intended account row was updated.
 * - Never prints, logs, or persists the plaintext password or password hash.
 *
 * Usage (run directly in your local terminal):
 *   node backend/scripts/reset-superadmin-password.mjs
 */

import { pathToFileURL } from 'node:url'
import { loadBackendEnv } from '../auth/envLoader.js'
import {
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
} from '../auth/adminPassword.js'
import {
  PRIMARY_SUPERADMIN_EMAIL,
  PRIMARY_SUPERADMIN_ID,
  recordAdminAuditLog,
  revokeAllSessionsForAdmin,
} from '../auth/adminSessionStore.js'
import { getSupabaseAdminClient } from '../lib/supabase.js'

const TARGET_SUPERADMIN_ID = PRIMARY_SUPERADMIN_ID // d9a494cb-1e8d-4bca-8142-19687fa9138b
const TARGET_SUPERADMIN_EMAIL = PRIMARY_SUPERADMIN_EMAIL // admin@inferxe.com

/**
 * Prompt for a secret string from an interactive TTY without echoing characters.
 * Restores terminal mode idempotently on Enter, Ctrl+C, SIGINT, SIGTERM,
 * process exit, stdin error, and stdin end. Ignores ANSI escape sequences.
 */
export function promptHidden(
  promptText,
  {
    stdin = process.stdin,
    stdout = process.stdout,
    proc = process,
  } = {},
) {
  return new Promise((resolve, reject) => {
    if (!stdin?.isTTY || !stdout?.isTTY) {
      reject(new Error('Interactive terminal (TTY) is required for hidden password input.'))
      return
    }

    let value = ''
    let settled = false
    let cleanedUp = false
    let inEscapeSeq = false
    let escapePrefix = false

    const cleanup = () => {
      if (cleanedUp) return
      cleanedUp = true
      stdin.removeListener('data', onData)
      stdin.removeListener('error', onStdinError)
      stdin.removeListener('end', onStdinEnd)
      proc.removeListener('SIGINT', onSigint)
      proc.removeListener('SIGTERM', onSigterm)
      proc.removeListener('exit', onExit)
      try {
        if (typeof stdin.setRawMode === 'function') {
          stdin.setRawMode(false)
        }
      } catch {
        // ignore terminal teardown errors
      }
      try {
        if (typeof stdin.pause === 'function') {
          stdin.pause()
        }
      } catch {
        // ignore
      }
    }

    const fail = (err, writeNewline = true) => {
      if (settled) return
      settled = true
      cleanup()
      if (writeNewline) {
        try {
          stdout.write('\n')
        } catch {
          // ignore
        }
      }
      reject(err)
    }

    const succeed = (result) => {
      if (settled) return
      settled = true
      cleanup()
      stdout.write('\n')
      resolve(result)
    }

    const onSigint = () => fail(new Error('Operation interrupted (SIGINT).'))
    const onSigterm = () => fail(new Error('Operation interrupted (SIGTERM).'))
    const onExit = () => cleanup()
    const onStdinError = (err) =>
      fail(err instanceof Error ? err : new Error('Terminal input stream error.'))
    const onStdinEnd = () => fail(new Error('Terminal input stream ended unexpectedly.'))

    const onData = (chunk) => {
      if (settled) return
      for (const ch of String(chunk)) {
        const code = ch.charCodeAt(0)

        if (ch === '\u0003') {
          // Ctrl+C in raw mode
          fail(new Error('Operation cancelled by user.'))
          return
        }

        if (ch === '\u001b') {
          // Start of an ANSI / VT100 escape sequence (e.g. arrow/Home/End/Function keys)
          inEscapeSeq = true
          escapePrefix = true
          continue
        }

        if (inEscapeSeq) {
          if (escapePrefix) {
            escapePrefix = false
            if (ch === '[' || ch === 'O') {
              // CSI (`ESC [`) or SS3 (`ESC O`) sequence continues until final byte 0x40..0x7E
              continue
            }
            // Two-byte escape sequence (e.g. Alt+key) ends here
            inEscapeSeq = false
            continue
          }
          // Consume CSI/SS3 parameter/intermediate bytes until final byte 0x40..0x7E
          if (code >= 0x40 && code <= 0x7e) {
            inEscapeSeq = false
          }
          continue
        }

        if (ch === '\r' || ch === '\n') {
          succeed(value)
          return
        }

        if (ch === '\u007f' || ch === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1)
          }
          continue
        }

        // Ignore remaining non-printable ASCII control characters
        if (code < 0x20) {
          continue
        }

        value += ch
      }
    }

    try {
      stdout.write(promptText)
      if (typeof stdin.setEncoding === 'function') {
        stdin.setEncoding('utf8')
      }
      stdin.setRawMode(true)
      stdin.resume()
      stdin.on('data', onData)
      stdin.on('error', onStdinError)
      stdin.on('end', onStdinEnd)
      proc.on('SIGINT', onSigint)
      proc.on('SIGTERM', onSigterm)
      proc.on('exit', onExit)
    } catch (err) {
      fail(err instanceof Error ? err : new Error('Failed to initialize hidden terminal input.'), false)
    }
  })
}

/**
 * Core controlled Super Admin password reset flow (dependency-injectable for offline mock testing).
 */
export async function runSuperadminPasswordReset(deps = {}) {
  const {
    loadEnv = loadBackendEnv,
    getClient = getSupabaseAdminClient,
    promptFn = promptHidden,
    revokeSessionsFn = revokeAllSessionsForAdmin,
    recordAuditFn = recordAdminAuditLog,
    stdin = process.stdin,
    stdout = process.stdout,
    log = console.log,
    errorLog = console.error,
  } = deps

  loadEnv()

  log('=== Inferxe Super Admin Controlled Password Reset ===')
  log(`Target Account ID:    ${TARGET_SUPERADMIN_ID}`)
  log(`Target Account Email: ${TARGET_SUPERADMIN_EMAIL}`)
  log('Password policy: 12–128 chars, upper, lower, number, and symbol.\n')

  if (!stdin?.isTTY || !stdout?.isTTY) {
    errorLog('Error: Please run this script directly in an interactive terminal.')
    return { ok: false, exitCode: 1, stage: 'tty_check' }
  }

  let newPassword = ''
  let confirmPassword = ''
  try {
    newPassword = await promptFn('Enter new Super Admin password: ')
    confirmPassword = await promptFn('Confirm new Super Admin password: ')
  } catch (err) {
    errorLog(`\nAborted: ${err.message}`)
    return { ok: false, exitCode: 1, stage: 'prompt' }
  }

  if (newPassword !== confirmPassword) {
    errorLog('Error: Password confirmation does not match. No changes were made.')
    return { ok: false, exitCode: 1, stage: 'confirm_mismatch' }
  }

  const strength = validatePasswordStrength(newPassword)
  if (!strength.valid) {
    errorLog(`Error: ${strength.error} No changes were made.`)
    return { ok: false, exitCode: 1, stage: 'strength_validation' }
  }

  let supabase
  try {
    supabase = getClient()
  } catch (err) {
    errorLog(`Error: Supabase backend configuration invalid: ${err.message}`)
    return { ok: false, exitCode: 1, stage: 'supabase_config' }
  }

  // 1. Verify the exact existing Super Admin record exists (compatible pre- and post-migration 004)
  const existingResult = await supabase
    .from('admin_users')
    .select('id, email, is_active, session_version')
    .eq('id', TARGET_SUPERADMIN_ID)

  if (existingResult.error) {
    errorLog(
      `Error: Failed to query admin_users (code=${existingResult.error.code || 'unknown'}): ${existingResult.error.message}`,
    )
    return { ok: false, exitCode: 1, stage: 'account_lookup' }
  }

  const matchingRows = existingResult.data || []
  if (matchingRows.length !== 1) {
    errorLog(
      `Error: Expected exactly 1 admin_users row for ID ${TARGET_SUPERADMIN_ID}, found ${matchingRows.length}. Aborting.`,
    )
    return { ok: false, exitCode: 1, stage: 'account_lookup' }
  }

  const existingAdmin = matchingRows[0]
  if (String(existingAdmin.email || '').trim().toLowerCase() !== TARGET_SUPERADMIN_EMAIL) {
    errorLog(
      'Error: Target account email does not match expected Super Admin email. Aborting without changes.',
    )
    return { ok: false, exitCode: 1, stage: 'account_verification' }
  }

  // 2. Generate Argon2id PHC hash and self-verify in memory before writing
  const newPasswordHash = hashPassword(newPassword)
  if (!verifyPassword(newPassword, newPasswordHash)) {
    errorLog('Error: Internal Argon2id self-verification failed. Aborting without changes.')
    return { ok: false, exitCode: 1, stage: 'hash_self_verify' }
  }

  // Clear plaintext references from local variables once hashed & verified
  newPassword = ''
  confirmPassword = ''

  const previousSessionVersion = Number(existingAdmin.session_version || 1)
  const nextSessionVersion = previousSessionVersion + 1
  const nowIso = new Date().toISOString()

  // 3. Update ONLY password_hash, session_version, and updated_at on the exact intended row
  const updateResult = await supabase
    .from('admin_users')
    .update({
      password_hash: newPasswordHash,
      session_version: nextSessionVersion,
      updated_at: nowIso,
    })
    .eq('id', TARGET_SUPERADMIN_ID)
    .eq('email', existingAdmin.email)
    .select('id, email, is_active, session_version, updated_at')

  if (updateResult.error) {
    errorLog(
      `Error: Failed to update admin_users (code=${updateResult.error.code || 'unknown'}): ${updateResult.error.message}`,
    )
    return { ok: false, exitCode: 1, stage: 'password_update' }
  }

  const updatedRows = updateResult.data || []
  if (
    updatedRows.length !== 1 ||
    String(updatedRows[0].id) !== TARGET_SUPERADMIN_ID ||
    String(updatedRows[0].email || '').trim().toLowerCase() !== TARGET_SUPERADMIN_EMAIL
  ) {
    errorLog(
      `Error: Unexpected update verification result (rows updated: ${updatedRows.length}). Please inspect admin_users.`,
    )
    return { ok: false, exitCode: 1, stage: 'update_verification' }
  }

  // 4. Revoke all active sessions for this Super Admin account with explicit partial-state reporting
  try {
    await revokeSessionsFn(TARGET_SUPERADMIN_ID, supabase)
  } catch (err) {
    errorLog('\nPARTIAL COMPLETION — ACTION REQUIRED:')
    errorLog(`- Updated Account ID:      ${updatedRows[0].id}`)
    errorLog(`- Updated Account Email:   ${updatedRows[0].email}`)
    errorLog(`- Password Hash Updated:   Yes (1 row updated)`)
    errorLog(
      `- Session Version Bumped:  ${previousSessionVersion} -> ${updatedRows[0].session_version} ` +
      '(old tokens are invalidated whenever verified against the database because session_version no longer matches)',
    )
    errorLog(
      `- Session Revocation:      FAILED (${err?.message || 'Unable to revoke active admin_sessions rows'})`,
    )
    errorLog('- Audit Log Recorded:      SKIPPED (follow-up required)')
    errorLog(
      'Follow-up required: revoke remaining active rows in public.admin_sessions for this account and record an audit entry.',
    )
    return { ok: false, exitCode: 1, stage: 'session_revocation_failed', partial: true }
  }

  // 5. Record non-secret audit event and fail non-zero if audit persistence fails
  let auditRecorded = false
  try {
    auditRecorded = Boolean(
      await recordAuditFn(
        {
          action: 'superadmin.password.reset_cli',
          targetType: 'admin_user',
          targetId: TARGET_SUPERADMIN_ID,
          details: {
            email: TARGET_SUPERADMIN_EMAIL,
            previous_session_version: previousSessionVersion,
            new_session_version: nextSessionVersion,
            sessions_revoked: true,
            method: 'local_interactive_cli',
          },
        },
        supabase,
      ),
    )
  } catch {
    auditRecorded = false
  }

  if (!auditRecorded) {
    errorLog('\nPARTIAL COMPLETION — AUDIT LOG FAILED:')
    errorLog(`- Updated Account ID:      ${updatedRows[0].id}`)
    errorLog(`- Updated Account Email:   ${updatedRows[0].email}`)
    errorLog(`- Rows Updated:            ${updatedRows.length}`)
    errorLog(`- Session Version Bumped:  ${previousSessionVersion} -> ${updatedRows[0].session_version}`)
    errorLog('- Existing Admin Sessions: Revoked')
    errorLog('- Audit Log Recorded:      FAILED (follow-up required to verify public.audit_logs permissions/connectivity)')
    return { ok: false, exitCode: 1, stage: 'audit_log_failed', partial: true }
  }

  log('\nSuper Admin password reset completed successfully.')
  log(`- Updated Account ID:      ${updatedRows[0].id}`)
  log(`- Updated Account Email:   ${updatedRows[0].email}`)
  log(`- Rows Updated:            ${updatedRows.length}`)
  log(`- Session Version Bumped:  ${previousSessionVersion} -> ${updatedRows[0].session_version}`)
  log('- Existing Admin Sessions: Revoked')
  log('- Audit Log Recorded:      Yes')
  log('\nYou can now sign in as admin@inferxe.com with your new password.')
  return { ok: true, exitCode: 0, stage: 'completed' }
}

const isDirectExecution =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectExecution) {
  runSuperadminPasswordReset()
    .then((result) => {
      process.exitCode = result.exitCode
    })
    .catch((err) => {
      console.error(`Unexpected error: ${err?.message || 'Password reset failed.'}`)
      process.exitCode = 1
    })
}
