import { describe, it, expect, vi } from 'vitest'
import { shouldFanOut, runFanOut } from '../src/fanoutLoop.js'

describe('fanoutLoop (DF-452)', () => {
  describe('shouldFanOut', () => {
    it('true only for a per-task plan with >=1 spec', () => {
      expect(shouldFanOut({ mode: 'per-task', specs: [{ taskId: 't1' }] })).toBe(true)
    })
    it('false for whole-flow / empty / null / garbage', () => {
      expect(shouldFanOut({ mode: 'whole-flow', specs: [{}] })).toBe(false)
      expect(shouldFanOut({ mode: 'per-task', specs: [] })).toBe(false)
      expect(shouldFanOut(null)).toBe(false)
      expect(shouldFanOut(undefined)).toBe(false)
      expect(shouldFanOut({})).toBe(false)
    })
  })

  describe('runFanOut', () => {
    const specs = [{ taskId: 'a' }, { taskId: 'b' }, { taskId: 'c' }]

    it('all workers pass → allDone, completed in order, all run', async () => {
      const runWorker = vi.fn(async (s) => ({ taskId: s.taskId, ok: true }))
      const r = await runFanOut({ specs, runWorker })
      expect(runWorker).toHaveBeenCalledTimes(3)
      expect(r).toEqual({ allDone: true, completed: ['a', 'b', 'c'], failed: [] })
    })

    it('a failing worker stops the loop early (subsequent workers not called)', async () => {
      const runWorker = vi.fn(async (s) => ({ taskId: s.taskId, ok: s.taskId !== 'b' }))
      const r = await runFanOut({ specs, runWorker })
      expect(runWorker).toHaveBeenCalledTimes(2) // a (ok) → b (fail) → stop
      expect(r.allDone).toBe(false)
      expect(r.completed).toEqual(['a'])
      expect(r.failed).toEqual([{ taskId: 'b', reason: 'failed' }])
    })

    it('a throwing worker counts as a failure and never throws', async () => {
      const runWorker = vi.fn(async () => { throw new Error('boom') })
      const r = await runFanOut({ specs: [{ taskId: 'x' }], runWorker })
      expect(r.allDone).toBe(false)
      expect(r.failed[0].reason).toBe('boom')
    })

    it('empty specs → allDone false, never throws', async () => {
      expect((await runFanOut({ specs: [], runWorker: async () => ({ ok: true }) })).allDone).toBe(false)
      await expect(runFanOut(undefined)).resolves.toEqual({ allDone: false, completed: [], failed: [] })
    })

    it('carries a custom failure reason', async () => {
      const runWorker = async (s) => ({ taskId: s.taskId, ok: false, reason: 'rate_limited' })
      const r = await runFanOut({ specs: [{ taskId: 'a' }], runWorker })
      expect(r.failed).toEqual([{ taskId: 'a', reason: 'rate_limited' }])
    })
  })
})
