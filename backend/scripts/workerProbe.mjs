import net from 'node:net'

/**
 * True when something accepts TCP connections on host:port within timeoutMs.
 * The gateway's /healthz uses it: a spawned Python process is not the same as a worker that answers requests.
 */
export function isPortAccepting(port, { host = '127.0.0.1', timeoutMs = 500 } = {}) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    const done = (ok) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}
