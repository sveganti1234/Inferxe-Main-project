/**
 * dev-stop.mjs — stop Inferxe dev services left running on Windows after `npm run dev` was killed
 * without Ctrl+C (closed terminal, task kill): Windows runs no exit handlers then, so uvicorn/vite survive.
 *
 * For each dev port it takes the listening process, walks up its parents, and stops the topmost
 * process whose command line is an Inferxe dev service (its whole tree). A listener that matches
 * no marker is reported and left alone, so unrelated programs are never stopped.
 */
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const DEV_PORTS = [5173, 5174, 8001, 8002]
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// Specific to this project's dev services. The repo path alone is not a marker (the editor has it in its command line).
const MARKERS = [
  /backend\.notifications\.main:app/i,
  /\binference\.main:app/i,
  /adminAuthServer\.mjs/i,
  /dev-(backend|frontend)\.mjs/i,
]
const VITE = /[\\/]vite[\\/]bin[\\/]vite\.js/i

export function isInferxeDevProcess(cmd, root = ROOT_DIR) {
  const c = cmd || ''
  return MARKERS.some((m) => m.test(c)) || (VITE.test(c) && c.toLowerCase().includes(root.toLowerCase())) // only this repo's vite
}

/** listeners: [{port, pid}]; processes: [{pid, ppid, cmd}] -> {targets: [pid], foreign: [{port, pid, cmd}]} */
export function pickTargets(listeners, processes, root = ROOT_DIR) {
  const byPid = new Map(processes.map((p) => [p.pid, p]))
  const targets = new Set()
  const foreign = []
  for (const { port, pid } of listeners) {
    let top = null
    const seen = new Set()
    for (let p = byPid.get(pid); p && !seen.has(p.pid); p = byPid.get(p.ppid)) {
      seen.add(p.pid)
      if (isInferxeDevProcess(p.cmd, root)) top = p.pid
    }
    if (top) targets.add(top)
    else foreign.push({ port, pid, cmd: byPid.get(pid)?.cmd || '' })
  }
  return { targets: [...targets], foreign }
}

function listeningPids(ports) {
  const out = spawnSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', windowsHide: true }).stdout || ''
  const rows = []
  for (const line of out.split(/\r?\n/)) {
    const m = line.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i)
    if (m && ports.includes(Number(m[1]))) rows.push({ port: Number(m[1]), pid: Number(m[2]) })
  }
  return rows
}

function processTable() {
  const ps = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress'
  const out = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 }).stdout
  return JSON.parse(out || '[]').map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, cmd: p.CommandLine || '' }))
}

function main() {
  if (process.platform !== 'win32') {
    console.log('[dev-stop] Only needed on Windows; elsewhere Ctrl+C stops the process group.')
    return
  }
  const listeners = listeningPids(DEV_PORTS)
  if (listeners.length === 0) return console.log(`[dev-stop] Nothing is listening on ${DEV_PORTS.join(', ')}.`)
  const { targets, foreign } = pickTargets(listeners, processTable())
  if (process.argv.includes('--dry-run')) {
    console.log(`[dev-stop] Would stop PIDs: ${targets.join(', ') || 'none'}; leave running: ${foreign.map((f) => `${f.port}:${f.pid}`).join(', ') || 'none'}.`)
    return
  }
  for (const pid of targets) {
    const r = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true })
    console.log(`[dev-stop] ${r.status === 0 ? 'Stopped' : 'Could not stop'} PID ${pid} and its child processes.`)
  }
  for (const f of foreign) console.warn(`[dev-stop] Port ${f.port} is used by PID ${f.pid}, which is not an Inferxe dev service; left running.`)
  const still = listeningPids(DEV_PORTS).filter((l) => !foreign.some((f) => f.pid === l.pid))
  if (still.length) {
    console.error(`[dev-stop] Still listening: ${still.map((l) => `${l.port} (PID ${l.pid})`).join(', ')}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
