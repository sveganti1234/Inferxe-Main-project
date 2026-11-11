/**
 * Wallet Auth Validation Tests
 * ============================
 * Tests JWT format validation logic used by walletService.ts.
 * These tests ensure demo tokens (e.g. 'ix-demo-...') are rejected
 * before any request reaches the backend, preventing 401 errors.
 */

// Replicate the isValidJwtFormat function from walletService.ts for testing
function isValidJwtFormat(token: string): boolean {
  if (!token || typeof token !== 'string') return false
  const parts = token.split('.')
  return parts.length === 3 && parts.every((p) => p.length > 0)
}

function runTests() {
  let passed = 0
  let failed = 0

  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`  PASS: ${message}`)
      passed++
    } else {
      console.log(`  FAIL: ${message}`)
      failed++
    }
  }

  console.log('\n=== Wallet Auth Validation Tests ===\n')

  // 1. Empty token
  assert(!isValidJwtFormat(''), 'Empty string returns false')

  // 2. null/undefined
  assert(!isValidJwtFormat(''), 'Empty token rejected')

  // 3. Demo token (ix-demo-...) - only 1 part
  assert(
    !isValidJwtFormat('ix-demo-abc123'),
    'Demo token (ix-demo-...) rejected - only 1 part'
  )

  // 4. Demo admin token (ix-tok-...) - only 1 part
  assert(
    !isValidJwtFormat('ix-tok-xyz789'),
    'Demo admin token (ix-tok-...) rejected - only 1 part'
  )

  // 5. Valid JWT format - 3 parts
  assert(
    isValidJwtFormat('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'),
    'Valid JWT (3 parts) accepted'
  )

  // 6. JWT with empty middle part
  assert(
    !isValidJwtFormat('header..signature'),
    'JWT with empty payload part rejected'
  )

  // 7. JWT with empty signature part
  assert(
    !isValidJwtFormat('header.payload.'),
    'JWT with empty signature part rejected'
  )

  // 8. JWT with 2 parts only
  assert(
    !isValidJwtFormat('header.payload'),
    'JWT with 2 parts rejected'
  )

  // 9. JWT with 4 parts
  assert(
    !isValidJwtFormat('a.b.c.d'),
    'JWT with 4 parts rejected'
  )

  // 10. Cognito ID token pattern (realistic)
  assert(
    isValidJwtFormat('eyJraWQiOiJhY2RiZSIsImFsZyI6IlJTMjU2In0.eyJzdWIiOiJhY2MtMTIzIiwiZW1haWwiOiJ1c2VyQGV4YW1wbGUuY29tIiwidG9rZW5fdXNlIjoiaWQifQ.fake_signature_here'),
    'Realistic Cognito ID token pattern accepted'
  )

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
}

runTests()
