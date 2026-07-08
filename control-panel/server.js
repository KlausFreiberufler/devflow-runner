import http from 'node:http'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { createLogBuffer, sseFormat, nextRunnerStatus } from './panelLogic.js'

/**
 * DF-454 — local control panel for the DevFlow runner.
 *
 * A tiny localhost web UI (no external deps) to start/stop the runner `watch`
 * process and stream its output live to the browser. Bound to 127.0.0.1 only —
 * no auth, not exposed to the network. The heavy logic (ring buffer, SSE frame,
 * status derivation) lives in panelLogic.js and is unit-tested.
 */
export function startPanel({ port = 7420, runnerRoot = process.cwd() } = {}) {
  const buffer = createLogBuffer(500)
  const sseClients = new Set()
  let child = null
  let status = 'idle'

  function broadcast(payload) {
    const frame = sseFormat(payload)
    for (const res of sseClients) {
      try { res.write(frame) } catch { /* client gone */ }
    }
  }

  function setStatus(next) {
    if (next && next !== status) {
      status = next
      broadcast({ type: 'status', status })
    }
  }

  function pushLine(line) {
    const text = line.replace(/\s+$/, '')
    if (!text) return
    buffer.push(text)
    setStatus(nextRunnerStatus(status, text))
    broadcast({ type: 'log', line: text })
  }

  function wireChild(proc) {
    const onData = (chunk) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) pushLine(line)
      }
    }
    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', onData)
    proc.on('exit', (code) => {
      pushLine(`Runner process exited (code ${code}).`)
      setStatus('stopped')
      child = null
    })
    proc.on('error', (err) => {
      pushLine(`Failed to start runner: ${err.message}`)
      setStatus('stopped')
      child = null
    })
  }

  function startRunner() {
    if (child) return { ok: false, error: 'already_running' }
    setStatus('running')
    pushLine('▶ Starting runner (watch)…')
    child = spawn(process.execPath, [join(runnerRoot, 'bin', 'devflow-run.js'), 'watch'], {
      cwd: runnerRoot,
      env: process.env,
    })
    wireChild(child)
    return { ok: true }
  }

  function stopRunner() {
    if (!child) return { ok: false, error: 'not_running' }
    pushLine('■ Stopping runner…')
    child.kill('SIGTERM')
    return { ok: true }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`)

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(PAGE)
      return
    }

    if (req.method === 'GET' && url.pathname === '/status') {
      let paths = {}
      try {
        const cfg = await import('../src/utils/config.js')
        paths = cfg.loadProjectPaths ? cfg.loadProjectPaths() : {}
      } catch { paths = {} }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status, pid: child?.pid ?? null, projectPaths: paths }))
      return
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      res.write(sseFormat({ type: 'status', status }))
      for (const line of buffer.toArray()) res.write(sseFormat({ type: 'log', line }))
      sseClients.add(res)
      req.on('close', () => sseClients.delete(res))
      return
    }

    if (req.method === 'POST' && url.pathname === '/start') {
      const r = startRunner()
      res.writeHead(r.ok ? 200 : 409, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(r))
      return
    }

    if (req.method === 'POST' && url.pathname === '/stop') {
      const r = stopRunner()
      res.writeHead(r.ok ? 200 : 409, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(r))
      return
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
  })

  // localhost only — never bind 0.0.0.0.
  server.listen(port, '127.0.0.1')
  return { server, url: `http://127.0.0.1:${port}` }
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DevFlow Runner</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 -apple-system, system-ui, sans-serif; margin: 0; background: #0f1115; color: #e6e6e6; }
  header { display: flex; align-items: center; gap: 12px; padding: 14px 18px; border-bottom: 1px solid #262b33; background: #151922; position: sticky; top: 0; }
  h1 { font-size: 15px; margin: 0; font-weight: 600; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: #6b7280; box-shadow: 0 0 0 3px rgba(107,114,128,.15); }
  .dot.running, .dot.connected { background: #22c55e; box-shadow: 0 0 0 3px rgba(34,197,94,.18); }
  .dot.reconnecting { background: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,.18); }
  .dot.stopped { background: #ef4444; box-shadow: 0 0 0 3px rgba(239,68,68,.18); }
  #status { font-weight: 600; text-transform: capitalize; }
  .spacer { flex: 1; }
  button { font: inherit; font-weight: 600; border: 1px solid #2f3742; background: #1c2230; color: #e6e6e6; padding: 6px 14px; border-radius: 8px; cursor: pointer; }
  button:hover { background: #242c3b; }
  button:disabled { opacity: .45; cursor: not-allowed; }
  #start { border-color: #1f7a44; } #stop { border-color: #7a2a2a; }
  pre { margin: 0; padding: 14px 18px; white-space: pre-wrap; word-break: break-word; font: 12px/1.5 ui-monospace, Menlo, monospace; }
  #log { height: calc(100vh - 52px); overflow-y: auto; }
</style></head><body>
<header>
  <span class="dot" id="dot"></span>
  <h1>DevFlow Runner</h1>
  <span id="status">idle</span>
  <span class="spacer"></span>
  <button id="start">Start</button>
  <button id="stop" disabled>Stop</button>
</header>
<div id="log"><pre id="pre"></pre></div>
<script>
  const pre = document.getElementById('pre');
  const dot = document.getElementById('dot');
  const statusEl = document.getElementById('status');
  const startBtn = document.getElementById('start');
  const stopBtn = document.getElementById('stop');
  const logEl = document.getElementById('log');

  function setStatus(s) {
    statusEl.textContent = s;
    dot.className = 'dot ' + s;
    const active = (s === 'running' || s === 'connected' || s === 'reconnecting');
    startBtn.disabled = active;
    stopBtn.disabled = !active;
  }
  function append(line) {
    const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
    pre.textContent += line + '\\n';
    if (atBottom) logEl.scrollTop = logEl.scrollHeight;
  }
  const es = new EventSource('/events');
  es.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'log') append(msg.line);
    else if (msg.type === 'status') setStatus(msg.status);
  };
  startBtn.onclick = () => fetch('/start', { method: 'POST' });
  stopBtn.onclick = () => fetch('/stop', { method: 'POST' });
</script>
</body></html>`
