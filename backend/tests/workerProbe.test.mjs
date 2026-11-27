import './support/networkGuard.mjs'  // test isolation guard: must stay the first import (tests/testSafety.test.mjs checks)
import assert from 'node:assert/strict'
import net from 'node:net'
import test from 'node:test'
import { isPortAccepting } from '../scripts/workerProbe.mjs'

// /healthz must report a worker as down when nothing listens on its port, and up when it accepts connections.
test('a listening port is reported reachable', async () => {
  const server = net.createServer((s) => s.end())
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    assert.equal(await isPortAccepting(server.address().port), true)
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('a closed port is reported unreachable, quickly', async () => {
  const server = net.createServer()
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  await new Promise((r) => server.close(r))
  const started = Date.now()
  assert.equal(await isPortAccepting(port, { timeoutMs: 500 }), false)
  assert.ok(Date.now() - started < 2000)
})
