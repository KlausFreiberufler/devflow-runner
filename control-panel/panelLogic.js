/**
 * DF-454 — pure helpers for the local runner control panel (no IO, testable).
 * Never throw.
 */

/** Fixed-size ring buffer for log lines. */
export function createLogBuffer(max = 500) {
  const cap = Number(max) > 0 ? Math.floor(Number(max)) : 500
  let lines = []
  return {
    push(line) {
      if (line == null) return
      lines.push(String(line))
      if (lines.length > cap) lines = lines.slice(lines.length - cap)
    },
    toArray() {
      return lines.slice()
    },
    get length() {
      return lines.length
    },
  }
}

/**
 * Format a payload as a Server-Sent-Events frame. JSON-encoding keeps embedded
 * newlines from breaking the `data:` framing. Always ends with a blank line.
 */
export function sseFormat(payload) {
  let json
  try {
    json = JSON.stringify(payload ?? null)
  } catch {
    json = 'null'
  }
  return `data: ${json}\n\n`
}

/**
 * Derive the runner status from a fresh output line (the runner logs distinct
 * markers). Falls back to the current status when a line is uninformative.
 * @returns {'idle'|'running'|'connected'|'reconnecting'|'stopped'}
 */
export function nextRunnerStatus(current, line) {
  const cur = current || 'idle'
  const text = typeof line === 'string' ? line : ''
  if (/Watch mode stopped|process exited|✅ .*finished|SIGTERM/i.test(text)) return 'stopped'
  if (/🔌 Connected|Connected to DevFlow/i.test(text)) return 'connected'
  if (/Disconnected|Reconnecting/i.test(text)) return 'reconnecting'
  if (/Watch mode started|Polling every/i.test(text)) return 'running'
  return cur
}
