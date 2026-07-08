import { describe, it, expect } from 'vitest'
import { createLogBuffer, sseFormat, nextRunnerStatus } from '../control-panel/panelLogic.js'

describe('control-panel panelLogic (DF-454)', () => {
  describe('createLogBuffer', () => {
    it('keeps lines in order and caps at max (ring)', () => {
      const buf = createLogBuffer(3)
      buf.push('a'); buf.push('b'); buf.push('c'); buf.push('d')
      expect(buf.toArray()).toEqual(['b', 'c', 'd'])
      expect(buf.length).toBe(3)
    })
    it('ignores null/undefined and coerces to string; never throws', () => {
      const buf = createLogBuffer(5)
      buf.push(null); buf.push(undefined); buf.push(42)
      expect(buf.toArray()).toEqual(['42'])
      expect(() => createLogBuffer(0)).not.toThrow()
      expect(() => createLogBuffer(-1).push('x')).not.toThrow()
    })
  })

  describe('sseFormat', () => {
    it('produces a valid data: frame ending in a blank line', () => {
      expect(sseFormat({ line: 'hello' })).toBe('data: {"line":"hello"}\n\n')
    })
    it('keeps embedded newlines from breaking the frame (JSON-escaped)', () => {
      const out = sseFormat({ line: 'a\nb' })
      expect(out.endsWith('\n\n')).toBe(true)
      expect(out.split('\n\n')[0]).toBe('data: {"line":"a\\nb"}')
    })
    it('never throws on circular / undefined', () => {
      const circ = {}; circ.self = circ
      expect(() => sseFormat(circ)).not.toThrow()
      expect(sseFormat(undefined)).toBe('data: null\n\n')
    })
  })

  describe('nextRunnerStatus', () => {
    it('maps known markers', () => {
      expect(nextRunnerStatus('idle', 'Watch mode started. Press Ctrl+C to stop.')).toBe('running')
      expect(nextRunnerStatus('running', '🔌 Connected to DevFlow (Socket.IO)')).toBe('connected')
      expect(nextRunnerStatus('connected', '🔌 Disconnected: transport close. Reconnecting...')).toBe('reconnecting')
      expect(nextRunnerStatus('running', 'Watch mode stopped.')).toBe('stopped')
    })
    it('keeps current status on uninformative lines; null-safe', () => {
      expect(nextRunnerStatus('connected', '📥 Job received: DF-1')).toBe('connected')
      expect(nextRunnerStatus(undefined, undefined)).toBe('idle')
      expect(() => nextRunnerStatus(null, null)).not.toThrow()
    })
  })
})
