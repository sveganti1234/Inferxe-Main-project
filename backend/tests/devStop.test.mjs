import './support/networkGuard.mjs'  // test isolation guard: must stay the first import (tests/testSafety.test.mjs checks)
import assert from 'node:assert/strict'
import test from 'node:test'
import { pickTargets } from '../scripts/dev-stop.mjs'

const PROCS = [
  { pid: 1, ppid: 0, cmd: '"C:\\Code.exe" c:\\Users\\a\\Inferxe-Main-project-1' },              // editor: never a target
  { pid: 10, ppid: 1, cmd: 'node backend/scripts/dev-backend.mjs' },
  { pid: 11, ppid: 10, cmd: 'python -m uvicorn backend.notifications.main:app --port 8002 --reload' },
  { pid: 12, ppid: 11, cmd: 'python -c "from multiprocessing.spawn import spawn_main; spawn_main()"' }, // reload worker
  { pid: 20, ppid: 1, cmd: 'node backend/auth/adminAuthServer.mjs' },
  // orphaned vite (its dev-frontend.mjs parent is gone), as Windows really shows it:
  { pid: 30, ppid: 999, cmd: '"node" "C:\\Users\\a\\Inferxe-Main-project-1\\node_modules\\.bin\\\\..\\vite\\bin\\vite.js" --port 5173' },
  { pid: 40, ppid: 1, cmd: 'C:\\Program Files\\Other\\server.exe --port 8001' },             // unrelated program
  { pid: 50, ppid: 1, cmd: '"node" "C:\\other-project\\node_modules\\vite\\bin\\vite.js"' },  // another project's vite
]
const ROOT = 'C:\\Users\\a\\Inferxe-Main-project-1'

test('stops the topmost Inferxe dev process above each listener, never the editor or unrelated programs', () => {
  const { targets, foreign } = pickTargets(
    [{ port: 8002, pid: 12 }, { port: 5174, pid: 20 }, { port: 5173, pid: 30 }, { port: 8001, pid: 40 }, { port: 5173, pid: 50 }],
    PROCS, ROOT,
  )
  assert.deepEqual(targets.sort((a, b) => a - b), [10, 20, 30])
  assert.deepEqual(foreign.map((f) => f.pid), [40, 50])
})

test('a listener whose process is unknown is reported, not stopped; parent cycles terminate', () => {
  const { targets, foreign } = pickTargets([{ port: 8001, pid: 99 }, { port: 8002, pid: 50 }], [
    { pid: 50, ppid: 51, cmd: 'x' }, { pid: 51, ppid: 50, cmd: 'y' },
  ])
  assert.deepEqual(targets, [])
  assert.deepEqual(foreign.map((f) => f.pid), [99, 50])
})
