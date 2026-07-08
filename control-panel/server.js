import http from 'node:http'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { createLogBuffer, sseFormat, nextRunnerStatus, mergeProjectPaths } from './panelLogic.js'

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

    // DF-455 — list projects (from the API) merged with local paths. Robust:
    // no token / offline → { ok:false, error } (never a hard 500).
    if (req.method === 'GET' && url.pathname === '/projects') {
      try {
        const cfg = await import('../src/utils/config.js')
        const { DevFlowClient } = await import('../src/client.js')
        const conf = cfg.loadConfig()
        const client = new DevFlowClient(conf.apiUrl, cfg.loadToken())
        // /api/runner/status is runner-token authorized and returns exactly the
        // projects this runner is scoped to (unlike /api/projects, which the
        // runner token cannot list).
        const st = await client.getRunnerStatus()
        const projects = (st?.enabledProjects || []).map(p => ({ id: p.projectId, name: p.projectName }))
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, projects: mergeProjectPaths(projects, cfg.loadProjectPaths()) }))
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message, projects: [] }))
      }
      return
    }

    // DF-455 — set the local working directory for a project.
    if (req.method === 'POST' && url.pathname === '/project-path') {
      let body = ''
      req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy() })
      req.on('end', async () => {
        try {
          const { projectId, projectName, path } = JSON.parse(body || '{}')
          if (!projectId || !path || !String(path).trim()) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'projectId and non-empty path required' }))
            return
          }
          const cfg = await import('../src/utils/config.js')
          cfg.saveProjectPath(projectId, projectName || projectId, String(path).trim())
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, path: String(path).trim() }))
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: err.message }))
        }
      })
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
  body { font: 14px/1.5 -apple-system, system-ui, sans-serif; margin: 0; background: #0f1115; color: #e6e6e6; display: flex; flex-direction: column; height: 100vh; }
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
  #log { flex: 1; overflow-y: auto; }
  details.projects { border-bottom: 1px solid #262b33; background: #12151c; }
  details.projects > summary { cursor: pointer; padding: 10px 18px; font-weight: 600; font-size: 13px; }
  .proj { display: flex; align-items: center; gap: 8px; padding: 6px 18px; }
  .proj .pname { width: 160px; flex-shrink: 0; color: #b9c0cc; }
  .proj input { flex: 1; font: inherit; padding: 5px 8px; border-radius: 6px; border: 1px solid #2f3742; background: #0f1115; color: #e6e6e6; }
  .proj button { padding: 5px 12px; }
  .proj .saved { color: #22c55e; font-size: 12px; }
  #projErr { padding: 6px 18px; color: #f59e0b; font-size: 12px; }
</style></head><body>
<header>
  <span class="dot" id="dot"></span>
  <h1>DevFlow Runner</h1>
  <span id="status">idle</span>
  <span class="spacer"></span>
  <button id="start">Start</button>
  <button id="stop" disabled>Stop</button>
</header>
<details class="projects" open>
  <summary>Projects — working directories</summary>
  <div id="projErr" hidden></div>
  <div id="projList"></div>
</details>
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

  // DF-455 — projects / working-directory editor
  const projList = document.getElementById('projList');
  const projErr = document.getElementById('projErr');
  async function loadProjects() {
    try {
      const r = await fetch('/projects').then(x => x.json());
      if (!r.ok) { projErr.hidden = false; projErr.textContent = 'Could not load projects: ' + (r.error || 'unknown') + ' (run setup first?)'; projList.innerHTML = ''; return; }
      projErr.hidden = true;
      projList.innerHTML = '';
      for (const p of r.projects) {
        const row = document.createElement('div');
        row.className = 'proj';
        const name = document.createElement('span'); name.className = 'pname'; name.textContent = p.name;
        const input = document.createElement('input'); input.value = p.path || ''; input.placeholder = 'local repo path, e.g. /Users/you/repo';
        const btn = document.createElement('button'); btn.textContent = 'Save';
        const ok = document.createElement('span'); ok.className = 'saved';
        btn.onclick = async () => {
          ok.textContent = '';
          const res = await fetch('/project-path', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: p.id, projectName: p.name, path: input.value }) }).then(x => x.json()).catch(() => ({ ok: false }));
          ok.textContent = res.ok ? '✓ saved' : '✗ ' + (res.error || 'failed');
        };
        row.append(name, input, btn, ok);
        projList.appendChild(row);
      }
    } catch (e) { projErr.hidden = false; projErr.textContent = 'Could not load projects.'; }
  }
  loadProjects();
</script>
</body></html>`
