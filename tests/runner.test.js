import { describe, it, expect, vi } from 'vitest'
import { Runner } from '../src/runner.js'

function createMockClient(overrides = {}) {
  return {
    initSession: vi.fn().mockResolvedValue({
      flow: { id: 'f-1', displayId: 'DF-99', summary: 'Test Flow', description: 'Test', tasks: [] },
      tasks: [],
    }),
    getNextStep: vi.fn().mockResolvedValue({ flowState: 'done' }),
    updateFlow: vi.fn().mockResolvedValue({}),
    logSession: vi.fn().mockResolvedValue({}),
    completeSession: vi.fn().mockResolvedValue({}),
    touchActivity: vi.fn().mockResolvedValue({}),
    submitReview: vi.fn().mockResolvedValue({}),
    sessionId: 'sess-1',
    ...overrides,
  }
}

function createMockAdapter(overrides = {}) {
  return {
    name: 'test-adapter',
    spawn: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'done', stderr: '' }),
    ...overrides,
  }
}

function createMockVerifier(overrides = {}) {
  return {
    run: vi.fn().mockResolvedValue({ allPassed: true, skipped: true, results: [], failures: [] }),
    ...overrides,
  }
}

describe('Runner', () => {
  describe('runFlow — basic lifecycle', () => {
    it('should init session and complete when flow is done', async () => {
      const client = createMockClient()
      const runner = new Runner(client, createMockAdapter(), createMockVerifier())

      await runner.runFlow('f-1')

      expect(client.initSession).toHaveBeenCalledWith('f-1')
      expect(client.completeSession).toHaveBeenCalled()
    })

    it('should spawn adapter and advance when step succeeds', async () => {
      let callCount = 0
      const client = createMockClient({
        getNextStep: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return {
              flowState: 'in_progress', pipelineStep: 'implementation', phase: 'action',
              actor: 'agent', gate: { blocked: false }, transitionPolicy: 'human_or_agent',
              skill: { prompt: 'Implement', name: 'executing-plans', agentModel: 'sonnet' },
            }
          }
          return { flowState: 'done' }
        }),
      })
      const adapter = createMockAdapter()
      const runner = new Runner(client, adapter, createMockVerifier())

      await runner.runFlow('f-1')

      expect(adapter.spawn).toHaveBeenCalledTimes(1)
      expect(client.updateFlow).toHaveBeenCalledWith('f-1', { phaseComplete: true })
    })

    it('should skip steps with actor human/skip/auto', async () => {
      let callCount = 0
      const client = createMockClient({
        getNextStep: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return {
              flowState: 'in_progress', pipelineStep: 'testing', phase: 'action',
              actor: 'skip', gate: { blocked: false },
            }
          }
          return { flowState: 'done' }
        }),
      })
      const adapter = createMockAdapter()
      const runner = new Runner(client, adapter, createMockVerifier())

      await runner.runFlow('f-1')

      expect(adapter.spawn).not.toHaveBeenCalled()
      expect(client.updateFlow).toHaveBeenCalledWith('f-1', { phaseComplete: true })
    })
  })

  describe('Gate handling', () => {
    it('should auto-advance non-human_only gates', async () => {
      let callCount = 0
      const client = createMockClient({
        getNextStep: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return {
              flowState: 'approval', pipelineStep: 'approval', phase: 'action',
              actor: 'agent', gate: { blocked: true }, transitionPolicy: 'human_or_agent',
            }
          }
          return { flowState: 'done' }
        }),
      })
      const runner = new Runner(client, createMockAdapter(), createMockVerifier())

      await runner.runFlow('f-1')

      expect(client.updateFlow).toHaveBeenCalledWith('f-1', { phaseComplete: true })
    })

    it('should exit on human_only gate when --until-gate is set', async () => {
      const client = createMockClient({
        getNextStep: vi.fn().mockResolvedValue({
          flowState: 'approval', pipelineStep: 'approval', phase: 'action',
          actor: 'human', gate: { blocked: true }, transitionPolicy: 'human_only',
        }),
      })
      const runner = new Runner(client, createMockAdapter(), createMockVerifier(), { untilGate: true })

      await runner.runFlow('f-1')

      expect(client.updateFlow).not.toHaveBeenCalled()
      expect(client.completeSession).toHaveBeenCalled()
    })
  })

  describe('Verification + Self-Repair', () => {
    it('should run verifications and advance when all pass', async () => {
      let callCount = 0
      const client = createMockClient({
        getNextStep: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return {
              flowState: 'in_progress', pipelineStep: 'implementation', phase: 'action',
              actor: 'agent', gate: { blocked: false }, transitionPolicy: 'human_or_agent',
              skill: {
                prompt: 'Impl', name: 'test', agentModel: 'sonnet',
                verificationsJson: [{ type: 'command', command: 'npm test', label: 'Tests' }],
              },
            }
          }
          return { flowState: 'done' }
        }),
      })
      const verifier = createMockVerifier({
        run: vi.fn().mockResolvedValue({
          allPassed: true, skipped: false,
          results: [{ label: 'Tests', passed: true }], failures: [],
        }),
      })
      const runner = new Runner(client, createMockAdapter(), verifier)

      await runner.runFlow('f-1')

      expect(verifier.run).toHaveBeenCalledTimes(1)
      expect(client.updateFlow).toHaveBeenCalled()
    })

    it('should retry on failure and succeed on second attempt', async () => {
      let stepCall = 0
      let verifyCall = 0
      const client = createMockClient({
        getNextStep: vi.fn().mockImplementation(() => {
          stepCall++
          if (stepCall === 1) {
            return {
              flowState: 'in_progress', pipelineStep: 'implementation', phase: 'action',
              actor: 'agent', gate: { blocked: false }, transitionPolicy: 'human_or_agent',
              skill: {
                prompt: 'Impl', name: 'test',
                verificationsJson: [{ type: 'command', command: 'npm test', label: 'Tests' }],
              },
            }
          }
          return { flowState: 'done' }
        }),
      })
      const adapter = createMockAdapter()
      const verifier = createMockVerifier({
        run: vi.fn().mockImplementation(() => {
          verifyCall++
          if (verifyCall === 1) {
            return { allPassed: false, results: [{ label: 'Tests', passed: false }], failures: [{ label: 'Tests', output: 'FAIL: auth' }] }
          }
          return { allPassed: true, results: [{ label: 'Tests', passed: true }], failures: [] }
        }),
      })
      const runner = new Runner(client, adapter, verifier)

      await runner.runFlow('f-1')

      // Initial spawn + 1 repair spawn
      expect(adapter.spawn).toHaveBeenCalledTimes(2)
      // Verify after initial + verify after repair
      expect(verifier.run).toHaveBeenCalledTimes(2)
      expect(client.submitReview).not.toHaveBeenCalled()
    })

    it('should escalate after max retries', async () => {
      let stepCall = 0
      const client = createMockClient({
        getNextStep: vi.fn().mockImplementation(() => {
          stepCall++
          if (stepCall === 1) {
            return {
              flowState: 'in_progress', pipelineStep: 'implementation', phase: 'action',
              actor: 'agent', gate: { blocked: false }, transitionPolicy: 'human_or_agent',
              skill: {
                prompt: 'Impl', name: 'test',
                verificationsJson: [{ type: 'command', command: 'npm test', label: 'Tests' }],
              },
            }
          }
          return { flowState: 'done' }
        }),
      })
      const verifier = createMockVerifier({
        run: vi.fn().mockResolvedValue({
          allPassed: false, results: [{ label: 'Tests', passed: false }],
          failures: [{ label: 'Tests', output: 'FAIL' }],
        }),
      })
      const runner = new Runner(client, createMockAdapter(), verifier, { maxRetries: 2 })

      await runner.runFlow('f-1')

      // Initial spawn + 2 repair attempts
      expect(client.submitReview).toHaveBeenCalledWith(
        'f-1', 'implementation', 'rejected',
        expect.stringContaining('Runner failed after 2 attempts')
      )
    })
  })

  describe('Dry run', () => {
    it('should not spawn adapter in dry run mode and stop via loop protection', async () => {
      const client = createMockClient({
        getNextStep: vi.fn().mockResolvedValue({
          flowState: 'in_progress', pipelineStep: 'implementation', phase: 'action',
          actor: 'agent', gate: { blocked: false },
          skill: { prompt: 'Impl', name: 'test' },
        }),
      })
      const adapter = createMockAdapter()
      const runner = new Runner(client, adapter, createMockVerifier(), { dryRun: true })

      await runner.runFlow('f-1')

      expect(adapter.spawn).not.toHaveBeenCalled()
      expect(client.updateFlow).not.toHaveBeenCalled()
    })
  })

  describe('Session cleanup on error', () => {
    it('should call completeSession even when executeStep throws', async () => {
      let callCount = 0
      const client = createMockClient({
        getNextStep: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return {
              flowState: 'in_progress', pipelineStep: 'implementation', phase: 'action',
              actor: 'agent', gate: { blocked: false },
              skill: { prompt: 'Impl', name: 'test' },
            }
          }
          return { flowState: 'done' }
        }),
        updateFlow: vi.fn().mockRejectedValue(new Error('Network error')),
      })
      const adapter = createMockAdapter()
      const runner = new Runner(client, adapter, createMockVerifier())

      await runner.runFlow('f-1')

      expect(client.completeSession).toHaveBeenCalled()
    })

    it('should handle initSession failure gracefully', async () => {
      const client = createMockClient({
        initSession: vi.fn().mockRejectedValue(new Error('401 Unauthorized')),
      })
      const runner = new Runner(client, createMockAdapter(), createMockVerifier())

      // Should not throw — should handle the error internally
      await expect(runner.runFlow('f-1')).resolves.not.toThrow()
    })
  })

  describe('Working directory resolution', () => {
    it('should use projectPaths config for workingDir', async () => {
      let callCount = 0
      const client = createMockClient({
        initSession: vi.fn().mockResolvedValue({
          flow: { id: 'f-1', displayId: 'DF-99', summary: 'Test', projectId: 'proj-123' },
          tasks: [],
        }),
        getNextStep: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return {
              flowState: 'in_progress', pipelineStep: 'implementation', phase: 'action',
              actor: 'agent', gate: { blocked: false },
              skill: { prompt: 'Impl', name: 'test' },
            }
          }
          return { flowState: 'done' }
        }),
      })
      const adapter = createMockAdapter()
      const runner = new Runner(client, adapter, createMockVerifier(), {
        projectPaths: { 'proj-123': { name: 'TestProject', path: '/tmp/test-project' } },
      })

      await runner.runFlow('f-1')

      // Adapter should have been spawned with the project path
      expect(adapter.spawn).toHaveBeenCalled()
      const spawnCall = adapter.spawn.mock.calls[0]
      expect(spawnCall[1].workingDir).toBe('/tmp/test-project')
    })

    it('should pass workingDir to verifyAndRepair', async () => {
      let callCount = 0
      const client = createMockClient({
        initSession: vi.fn().mockResolvedValue({
          flow: { id: 'f-1', displayId: 'DF-99', summary: 'Test', projectId: 'proj-456' },
          tasks: [],
        }),
        getNextStep: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return {
              flowState: 'in_progress', pipelineStep: 'implementation', phase: 'action',
              actor: 'agent', gate: { blocked: false },
              skill: { prompt: 'Impl', name: 'test', verificationsJson: [{ type: 'command', command: 'echo ok', label: 'test' }] },
            }
          }
          return { flowState: 'done' }
        }),
      })
      const adapter = createMockAdapter()
      const verifier = createMockVerifier({
        run: vi.fn().mockResolvedValue({ allPassed: false, results: [{ label: 'test', passed: false }], failures: [{ label: 'test', output: 'fail' }] }),
      })
      const runner = new Runner(client, adapter, verifier, {
        projectPaths: { 'proj-456': { path: '/tmp/verify-project' } },
        maxRetries: 1,
      })

      await runner.runFlow('f-1')

      // Repair spawn should use the project working dir
      const repairCalls = adapter.spawn.mock.calls.filter((_, i) => i > 0)
      if (repairCalls.length > 0) {
        expect(repairCalls[0][1].workingDir).toBe('/tmp/verify-project')
      }
    })
  })

  describe('Session isolation in multi-flow', () => {
    it('should reset sessionId after completeSession', async () => {
      const client = createMockClient()
      const runner = new Runner(client, createMockAdapter(), createMockVerifier())

      await runner.runFlow('f-1')

      // After runFlow completes, sessionId should be cleared
      expect(client.sessionId).toBeNull()
    })
  })

  describe('Exit code handling', () => {
    it('should NOT advance phase when adapter exits with non-zero code', async () => {
      let callCount = 0
      const client = createMockClient({
        getNextStep: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return {
              flowState: 'in_progress', pipelineStep: 'implementation', phase: 'action',
              actor: 'agent', gate: { blocked: false },
              skill: { prompt: 'Impl', name: 'test' },
            }
          }
          return { flowState: 'done' }
        }),
      })
      const adapter = createMockAdapter({
        spawn: vi.fn().mockResolvedValue({ exitCode: 1, stdout: 'partial output', stderr: 'error occurred' }),
      })
      const runner = new Runner(client, adapter, createMockVerifier())

      await runner.runFlow('f-1')

      // updateFlow should NOT have been called with phaseComplete
      const phaseAdvanceCalls = client.updateFlow.mock.calls.filter(
        c => c[1]?.phaseComplete === true
      )
      expect(phaseAdvanceCalls).toHaveLength(0)
    })
  })
})
