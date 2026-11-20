/**
 * Network guard for Node backend tests. Every test file imports it first (enforced by tests/testSafety.test.mjs),
 * and `npm test` also preloads it, so it is active however a test file is started (node --test, node file.mjs).
 *
 * It marks the process as a test process (INFERXE_NODE_TEST_GUARD=1: auth/envLoader.js then never loads the
 * project .env) and allows outbound connections only to loopback, plus, in live mode, the single validated
 * non-production Supabase host (lib/testSafety.js). A production live target stops the process before any test.
 * Blocked attempts are reported by host category only. Importing it more than once is harmless.
 */
import dns from 'node:dns'
import net from 'node:net'
import {
  applyLiveTarget,
  classifyHost,
  isHostAllowed,
  liveSupabaseTestsEnabled,
  TestSafetyError,
} from '../../lib/testSafety.js'

const GUARD = Symbol.for('inferxe.networkGuard')

function targetHost(args) {
  let first = args[0]
  if (Array.isArray(first)) first = first[0]  // node-internal normalized [options, callback]
  if (first && typeof first === 'object') {
    if (first.path) return null  // IPC / unix socket: local
    return first.host || 'localhost'
  }
  if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
    return typeof args[1] === 'string' ? args[1] : 'localhost'
  }
  return null  // string path: IPC
}

if (!globalThis[GUARD]) {
  process.env.INFERXE_NODE_TEST_GUARD = '1'
  if (liveSupabaseTestsEnabled()) applyLiveTarget()  // throws (stopping the run) for a production target

  const blocked = []
  const refuse = (host, kind) => {
    const category = classifyHost(host)
    blocked.push(category)
    return new TestSafetyError(`blocked ${kind} during tests (${category}). Mock the service or use a local test instance.`)
  }

  const realConnect = net.Socket.prototype.connect
  net.Socket.prototype.connect = function guardedConnect(...args) {
    const host = targetHost(args)
    if (host !== null && !isHostAllowed(host)) {
      const err = refuse(host, 'connection')
      process.nextTick(() => this.destroy(err))  // fail like a refused connection, without touching the network
      return this
    }
    return realConnect.apply(this, args)
  }

  const realLookup = dns.lookup
  dns.lookup = function guardedLookup(hostname, ...rest) {
    if (!isHostAllowed(hostname)) {
      const err = refuse(hostname, 'DNS lookup')
      const callback = rest.find((a) => typeof a === 'function')
      if (callback) return process.nextTick(() => callback(err))
      throw err
    }
    return realLookup.call(this, hostname, ...rest)
  }

  process.on('exit', () => {
    if (blocked.length) {
      const counts = {}
      for (const c of blocked) counts[c] = (counts[c] || 0) + 1
      const summary = Object.entries(counts).map(([c, n]) => `${n} x ${c}`).join(', ')
      process.stderr.write(`[test-safety] blocked outbound connection(s): ${summary}\n`)
    }
  })
  globalThis[GUARD] = { blocked }
}
