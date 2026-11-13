import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  BACKEND_ENV_PATH,
  FRONTEND_DIR,
  assertNoFrontendSupabaseSecrets,
  collectFrontendEnvForSecurityCheck,
  loadBackendEnv,
  parseEnvContent,
} from '../auth/envLoader.js'
import { upsertCognitoProfile } from '../database/supabaseProfiles.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '../..')

test('parseEnvContent parses quoted values, comments, export prefixes, and CRLF', () => {
  const parsed = parseEnvContent([
    '# comment line',
    'export SUPABASE_URL="https://example.supabase.co"',
    "SUPABASE_SERVICE_ROLE_KEY='sb_secret_dummy_value_with_equals==' # inline comment",
    'EMPTY_VAR=',
  ].join('\r\n'))

  assert.equal(parsed.SUPABASE_URL, 'https://example.supabase.co')
  assert.equal(parsed.SUPABASE_SERVICE_ROLE_KEY, 'sb_secret_dummy_value_with_equals==')
  assert.equal(parsed.EMPTY_VAR, '')
})

test('loadBackendEnv loads credentials from backend/.env path without overriding existing env', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inferxe-env-test-'))
  try {
    const tmpEnvPath = path.join(tmpDir, '.env')
    fs.writeFileSync(
      tmpEnvPath,
      'SUPABASE_URL=https://dummy.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=sb_secret_dummy_key\n',
      'utf8',
    )

    const targetEnv = { SUPABASE_URL: 'https://preexisting.supabase.co' }
    const result = loadBackendEnv({ envPath: tmpEnvPath, override: false, targetEnv })

    assert.equal(result.loaded, true)
    assert.equal(targetEnv.SUPABASE_URL, 'https://preexisting.supabase.co')
    assert.equal(targetEnv.SUPABASE_SERVICE_ROLE_KEY, 'sb_secret_dummy_key')
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('BACKEND_ENV_PATH points strictly to backend/.env regardless of working directory', () => {
  assert.equal(BACKEND_ENV_PATH, path.join(ROOT_DIR, 'backend', '.env'))
})

test('assertNoFrontendSupabaseSecrets blocks frontend secret exposure while allowing VITE_COGNITO_*', () => {
  assert.doesNotThrow(() =>
    assertNoFrontendSupabaseSecrets({
      VITE_COGNITO_REGION: 'ap-south-1',
      VITE_COGNITO_USER_POOL_ID: 'ap-south-1_test',
      VITE_COGNITO_CLIENT_ID: 'client123',
    }),
  )

  assert.throws(
    () => assertNoFrontendSupabaseSecrets({ VITE_SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_leaked' }),
    /Forbidden/,
  )
  assert.throws(
    () => assertNoFrontendSupabaseSecrets({ SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_leaked' }),
    /Forbidden/,
  )
  assert.throws(
    () => assertNoFrontendSupabaseSecrets({ VITE_SUPABASE_URL: 'https://example.supabase.co' }),
    /Forbidden/,
  )
})

test('collectFrontendEnvForSecurityCheck allows server-only process.env while blocking frontend/.env* and VITE_SUPABASE_* leaks', () => {
  assert.equal(FRONTEND_DIR, path.join(ROOT_DIR, 'frontend'))

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inferxe-fe-env-check-'))
  try {
    fs.writeFileSync(
      path.join(tmpDir, '.env'),
      'VITE_COGNITO_REGION=ap-south-1\nVITE_COGNITO_CLIENT_ID=client123\n',
      'utf8',
    )

    // Server-only process.env vars (e.g. from loadBackendEnv() on config reload or IDE shell) must be allowed.
    const clean = collectFrontendEnvForSecurityCheck({
      envDir: tmpDir,
      mode: 'development',
      processEnv: {
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_dummy_server_key',
        VITE_COGNITO_REGION: 'ap-south-1',
      },
    })
    assert.doesNotThrow(() => assertNoFrontendSupabaseSecrets(clean))
    assert.equal(clean.SUPABASE_URL, undefined)

    // Any VITE_SUPABASE_* in process.env must still fail.
    const leakedProcessVite = collectFrontendEnvForSecurityCheck({
      envDir: tmpDir,
      mode: 'development',
      processEnv: { VITE_SUPABASE_URL: 'https://example.supabase.co' },
    })
    assert.throws(() => assertNoFrontendSupabaseSecrets(leakedProcessVite), /Forbidden/)

    // Any SUPABASE_URL in frontend/.env.local must fail immediately (even if process.env is empty).
    fs.writeFileSync(path.join(tmpDir, '.env.local'), 'SUPABASE_URL=https://leaked.supabase.co\n', 'utf8')
    assert.throws(
      () =>
        collectFrontendEnvForSecurityCheck({
          envDir: tmpDir,
          mode: 'development',
          processEnv: {},
        }),
      /Forbidden/,
    )
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('upsertCognitoProfile uses apikey only for sb_secret_ keys and rejects PAT/publishable keys', async () => {
  let capturedHeaders
  await upsertCognitoProfile(
    { sub: 'cognito-sub-abc', email: 'user@example.test', name: 'Test User' },
    {
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'sb_secret_dummy_server_key',
      fetchImpl: async (_url, options) => {
        capturedHeaders = options.headers
        return new Response(null, { status: 204 })
      },
    },
  )

  assert.equal(capturedHeaders.apikey, 'sb_secret_dummy_server_key')
  assert.equal(capturedHeaders.Authorization, undefined)

  await assert.rejects(
    upsertCognitoProfile(
      { sub: 'cognito-sub-abc', email: 'user@example.test' },
      {
        supabaseUrl: 'https://example.supabase.co',
        serviceRoleKey: 'sbp_not_allowed_pat',
        fetchImpl: async () => assert.fail('must reject Personal Access Tokens'),
      },
    ),
    /secret\/service role key/,
  )

  await assert.rejects(
    upsertCognitoProfile(
      { sub: 'cognito-sub-abc', email: 'user@example.test' },
      {
        supabaseUrl: 'https://example.supabase.co',
        serviceRoleKey: 'sb_publishable_not_allowed',
        fetchImpl: async () => assert.fail('must reject Publishable keys'),
      },
    ),
    /secret\/service role key/,
  )
})

test('environment templates and Vite config never expose Supabase secrets to frontend', () => {
  const rootEnvExample = fs.readFileSync(path.join(ROOT_DIR, '.env.example'), 'utf8')
  const backendEnvExample = fs.readFileSync(path.join(ROOT_DIR, 'backend', '.env.example'), 'utf8')
  const viteConfig = fs.readFileSync(path.join(ROOT_DIR, 'frontend', 'vite.config.ts'), 'utf8')

  assert.match(backendEnvExample, /^SUPABASE_URL=https:\/\/your-project\.supabase\.co$/m)
  assert.match(backendEnvExample, /^SUPABASE_SERVICE_ROLE_KEY=$/m)
  assert.doesNotMatch(rootEnvExample, /^SUPABASE_SERVICE_ROLE_KEY=/m)
  assert.doesNotMatch(rootEnvExample, /VITE_SUPABASE_/)

  assert.match(viteConfig, /envPrefix:\s*'VITE_'/)
  assert.match(viteConfig, /assertNoFrontendSupabaseSecrets/)
  assert.match(viteConfig, /if \(command === 'serve'\)\s*\{\s*loadBackendEnv\(\)/)

  // Verify frontend/src never references SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_*
  const frontendSrcDir = path.join(ROOT_DIR, 'frontend', 'src')
  const stack = [frontendSrcDir]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
      } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
        const text = fs.readFileSync(fullPath, 'utf8')
        assert.doesNotMatch(text, /SUPABASE_SERVICE_ROLE_KEY|VITE_SUPABASE_|sb_secret_|sbp_/)
      }
    }
  }
})
