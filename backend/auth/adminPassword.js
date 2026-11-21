// @ts-nocheck
import crypto from 'node:crypto'

const SUPPORTED_VARIANTS = new Set(['argon2id', 'argon2i', 'argon2d'])

// OWASP-aligned Argon2id defaults for newly created developer admin accounts
const DEFAULT_ARGON2_MEMORY_KIB = 65536 // 64 MiB
const DEFAULT_ARGON2_PASSES = 3
const DEFAULT_ARGON2_PARALLELISM = 1
const DEFAULT_ARGON2_TAG_LENGTH = 32
const DEFAULT_SALT_LENGTH = 16

// Defensive bounds to prevent malformed hashes from exhausting memory/CPU
const MIN_MEMORY_KIB = 8
const MAX_MEMORY_KIB = 262144 // 256 MiB
const MIN_PASSES = 1
const MAX_PASSES = 20
const MIN_PARALLELISM = 1
const MAX_PARALLELISM = 16
const MIN_TAG_LENGTH = 16
const MAX_TAG_LENGTH = 64

const BLOCKED_WEAK_PASSWORDS = new Set([
  'admin',
  'admin123',
  'admin@123',
  'admin2026',
  'administrator',
  'password',
  'password123',
  'password@123',
  'qwerty@123',
  'inferxe@2026',
  'inferxe123',
  'changeme123!',
  'welcome123!',
])

function decodePhcBase64(value) {
  if (typeof value !== 'string' || !value) return null
  if (!/^[A-Za-z0-9+/=_-]+$/.test(value)) return null
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  const padLen = (4 - (normalized.length % 4)) % 4
  const padded = normalized + '='.repeat(padLen)
  const buf = Buffer.from(padded, 'base64')
  if (!buf.length) return null
  return buf
}

function encodePhcBase64(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/=+$/, '')
}

/**
 * Parse a standard PHC Argon2 string:
 *   $argon2id$v=19$m=65536,t=3,p=1$<salt>$<hash>
 * Also supports PHC strings without the explicit v=19 segment.
 */
export function parseArgon2Hash(storedHash) {
  if (typeof storedHash !== 'string') return null
  const trimmed = storedHash.trim()
  if (!trimmed.startsWith('$')) return null

  const parts = trimmed.split('$')
  // Expected: ['', variant, 'v=19', 'm=...,t=...,p=...', salt, hash]
  // Or without version: ['', variant, 'm=...,t=...,p=...', salt, hash]
  let variant = ''
  let version = 19
  let paramsPart = ''
  let saltB64 = ''
  let hashB64 = ''

  if (parts.length === 6) {
    variant = parts[1]
    const versionMatch = /^v=(\d+)$/.exec(parts[2])
    if (!versionMatch) return null
    version = Number(versionMatch[1])
    paramsPart = parts[3]
    saltB64 = parts[4]
    hashB64 = parts[5]
  } else if (parts.length === 5) {
    variant = parts[1]
    paramsPart = parts[2]
    saltB64 = parts[3]
    hashB64 = parts[4]
  } else {
    return null
  }

  if (!SUPPORTED_VARIANTS.has(variant)) return null
  if (version !== 19) return null

  const params = {}
  for (const segment of paramsPart.split(',')) {
    const [key, rawVal] = segment.split('=')
    if (!key || rawVal === undefined) return null
    const num = Number(rawVal)
    if (!Number.isInteger(num)) return null
    params[key] = num
  }

  const memory = params.m
  const passes = params.t
  const parallelism = params.p

  if (
    !Number.isInteger(memory) || memory < MIN_MEMORY_KIB || memory > MAX_MEMORY_KIB ||
    !Number.isInteger(passes) || passes < MIN_PASSES || passes > MAX_PASSES ||
    !Number.isInteger(parallelism) || parallelism < MIN_PARALLELISM || parallelism > MAX_PARALLELISM
  ) {
    return null
  }

  const salt = decodePhcBase64(saltB64)
  const expectedHash = decodePhcBase64(hashB64)
  if (!salt || salt.length < 8 || !expectedHash) return null
  if (expectedHash.length < MIN_TAG_LENGTH || expectedHash.length > MAX_TAG_LENGTH) return null

  return {
    variant,
    version,
    memory,
    passes,
    parallelism,
    salt,
    expectedHash,
  }
}

/**
 * Hash a plaintext password using Argon2id and return a standard PHC string.
 * Never logs or exposes plaintext passwords.
 */
export function hashPassword(password, options = {}) {
  if (typeof password !== 'string' || !password) {
    throw new Error('Password must be a non-empty string.')
  }
  if (typeof crypto.argon2Sync !== 'function') {
    throw new Error('Node.js runtime does not support native Argon2 hashing.')
  }

  const memory = Number.isInteger(options.memory) ? options.memory : DEFAULT_ARGON2_MEMORY_KIB
  const passes = Number.isInteger(options.passes) ? options.passes : DEFAULT_ARGON2_PASSES
  const parallelism = Number.isInteger(options.parallelism) ? options.parallelism : DEFAULT_ARGON2_PARALLELISM
  const tagLength = Number.isInteger(options.tagLength) ? options.tagLength : DEFAULT_ARGON2_TAG_LENGTH
  const salt = options.salt ? Buffer.from(options.salt) : crypto.randomBytes(DEFAULT_SALT_LENGTH)

  const derived = crypto.argon2Sync('argon2id', {
    message: Buffer.from(password, 'utf8'),
    nonce: salt,
    parallelism,
    tagLength,
    memory,
    passes,
  })

  return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${encodePhcBase64(salt)}$${encodePhcBase64(derived)}`
}

/**
 * Verify a plaintext password against a stored Argon2 ($argon2id$, $argon2i$, $argon2d$) PHC hash
 * and return a structured non-secret diagnostic reason distinguishing malformed stored hashes
 * from genuine password mismatches. Never logs or exposes passwords or hashes.
 */
export function verifyPasswordWithReason(password, storedHash) {
  try {
    if (typeof password !== 'string' || !password) {
      return { valid: false, reason: 'invalid_input' }
    }
    if (typeof storedHash !== 'string' || !storedHash.trim()) {
      return { valid: false, reason: 'malformed_hash' }
    }
    if (typeof crypto.argon2Sync !== 'function') {
      return { valid: false, reason: 'unsupported_runtime' }
    }

    const parsed = parseArgon2Hash(storedHash)
    if (!parsed) {
      return { valid: false, reason: 'malformed_hash' }
    }

    const derived = crypto.argon2Sync(parsed.variant, {
      message: Buffer.from(password, 'utf8'),
      nonce: parsed.salt,
      parallelism: parsed.parallelism,
      tagLength: parsed.expectedHash.length,
      memory: parsed.memory,
      passes: parsed.passes,
    })

    if (derived.length !== parsed.expectedHash.length) {
      return { valid: false, reason: 'mismatch' }
    }

    const matched = crypto.timingSafeEqual(derived, parsed.expectedHash)
    return {
      valid: matched,
      reason: matched ? 'ok' : 'mismatch',
      meta: {
        variant: parsed.variant,
        memory: parsed.memory,
        passes: parsed.passes,
        parallelism: parsed.parallelism,
      },
    }
  } catch {
    return { valid: false, reason: 'error' }
  }
}

/**
 * Verify a plaintext password against a stored Argon2 ($argon2id$, $argon2i$, $argon2d$) PHC hash.
 * Uses constant-time comparison and never throws on invalid/malformed inputs.
 */
export function verifyPassword(password, storedHash) {
  return verifyPasswordWithReason(password, storedHash).valid
}

/**
 * Validate password strength for newly created developer admin accounts.
 */
export function validatePasswordStrength(password) {
  if (typeof password !== 'string') {
    return { valid: false, error: 'Password is required.' }
  }
  if (password.length < 12) {
    return { valid: false, error: 'Password must be at least 12 characters long.' }
  }
  if (password.length > 128) {
    return { valid: false, error: 'Password must not exceed 128 characters.' }
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must include at least one uppercase letter.' }
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: 'Password must include at least one lowercase letter.' }
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must include at least one number.' }
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { valid: false, error: 'Password must include at least one special character.' }
  }
  if (BLOCKED_WEAK_PASSWORDS.has(password.trim().toLowerCase())) {
    return { valid: false, error: 'This password is too common. Please choose a stronger password.' }
  }
  return { valid: true }
}
