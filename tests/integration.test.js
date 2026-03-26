import { describe, it, expect, vi } from 'vitest'
import { Runner } from '../src/runner.js'

describe('Integration: Full Flow Lifecycle', () => {
  it('should complete a multi-step flow: plan → approve → implement → verify → done', async () => {
    let callCount = 0
    const client = {
      initSession: vi.fn().mockResolvedValue({
        flow: { id: 'f-1', displayId: 'DF-99', summary: 'Full Lifecycle Test', description: 'E2E test', tasks: [] },
        tasks: [],
      }),
      getNextStep: vi.fn().mockImplementation(() => {
        callCount++
        switch (callCount) {
          case 1: return {
            flowState: 'planning', pipelineStep: 'planning', phase: 'action',
            actor: 'agent', gate: { blocked: false }, transitionPolicy: 'human_or_agent',
            skill: { prompt: 'Write a plan', name: 'writing-plans', agentModel: 'opus' },
          }
          case 2: return {
            flowState: 'approval', pipelineStep: 'approval', phase: 'action',
            actor: 'agent', gate: { blocked: true }, transitionPolicy: 'human_or_agent',
          }
          case 3: return {
            flowState: 'in_progress', pipelineStep: 'implementation', phase: 'pre',
            actor: 'agent', gate: { blocked: false }, transitionPolicy: 'human_or_agent',
            skill: { prompt: 'Create branch', name: 'branch-creator', agentModel: 'sonnet' },
          }
          case 4: return {
            flowState: 'in_progress', pipelineStep: 'implementation', phase: 'action',
            actor: 'agent', gate: { blocked: false }, transitionPolicy: 'human_or_agent',
            skill: {
              prompt: 'Implement the plan', name: 'executing-plans', agentModel: 'sonnet',
              verificationsJson: [{ type: 'command', command: 'echo ok', label: 'Build' }],
            },
          }
          case 5: return {
            flowState: 'in_progress', pipelineStep: 'implementation', phase: 'after',
            actor: 'agent', gate: { blocked: false }, transitionPolicy: 'human_or_agent',
            skill: { prompt: 'Commit and PR', name: 'commit-and-pr', agentModel: 'sonnet' },
          }
          case 6: return {
            flowState: 'review', pipelineStep: 'code_review', phase: 'action',
            actor: 'agent', gate: { blocked: true }, transitionPolicy: 'human_or_agent',
          }
          default: return { flowState: 'done' }
        }
      }),
      updateFlow: vi.fn().mockResolvedValue({}),
      logSession: vi.fn().mockResolvedValue({}),
      completeSession: vi.fn().mockResolvedValue({}),
      touchActivity: vi.fn().mockResolvedValue({}),
      submitReview: vi.fn().mockResolvedValue({}),
      sessionId: 'sess-1',
    }

    const adapter = {
      name: 'claude',
      spawn: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' }),
    }

    const verifier = {
      run: vi.fn().mockResolvedValue({
        allPassed: true, skipped: false,
        results: [{ label: 'Build', passed: true }], failures: [],
      }),
    }

    const runner = new Runner(client, adapter, verifier)
    await runner.runFlow('f-1')

    // 4 agent steps spawned (planning, pre, action, after)
    expect(adapter.spawn).toHaveBeenCalledTimes(4)
    // 2 gates auto-advanced (approval, code_review)
    // + 4 phase completes from steps + 1 phase complete from gates
    expect(client.updateFlow).toHaveBeenCalled()
    // Verification ran once (only implementation:action had verificationsJson)
    expect(verifier.run).toHaveBeenCalledTimes(1)
    expect(client.completeSession).toHaveBeenCalled()
  })
})

describe('Integration: Self-Repair Loop', () => {
  it('should fail twice, succeed on third attempt, and advance', async () => {
    let stepCall = 0
    let verifyCall = 0

    const client = {
      initSession: vi.fn().mockResolvedValue({
        flow: { id: 'f-2', displayId: 'DF-100', summary: 'Repair Test', tasks: [] },
      }),
      getNextStep: vi.fn().mockImplementation(() => {
        stepCall++
        if (stepCall === 1) {
          return {
            flowState: 'in_progress', pipelineStep: 'implementation', phase: 'action',
            actor: 'agent', gate: { blocked: false }, transitionPolicy: 'human_or_agent',
            skill: {
              prompt: 'Implement', name: 'test',
              verificationsJson: [
                { type: 'command', command: 'npm test', label: 'API Tests' },
                { type: 'command', command: 'npm run build', label: 'Build' },
              ],
            },
          }
        }
        return { flowState: 'done' }
      }),
      updateFlow: vi.fn().mockResolvedValue({}),
      logSession: vi.fn().mockResolvedValue({}),
      completeSession: vi.fn().mockResolvedValue({}),
      touchActivity: vi.fn().mockResolvedValue({}),
      submitReview: vi.fn().mockResolvedValue({}),
      sessionId: 'sess-2',
    }

    const adapter = {
      name: 'claude',
      spawn: vi.fn().mockResolvedValue({ exitCode: 0 }),
    }

    const verifier = {
      run: vi.fn().mockImplementation(() => {
        verifyCall++
        if (verifyCall <= 2) {
          return {
            allPassed: false,
            results: [
              { label: 'API Tests', passed: false },
              { label: 'Build', passed: true },
            ],
            failures: [{ label: 'API Tests', output: 'FAIL: auth.test.ts - Expected 302, got 404' }],
          }
        }
        return {
          allPassed: true,
          results: [
            { label: 'API Tests', passed: true },
            { label: 'Build', passed: true },
          ],
          failures: [],
        }
      }),
    }

    const runner = new Runner(client, adapter, verifier, { maxRetries: 3 })
    await runner.runFlow('f-2')

    // 1 initial + 2 repair attempts = 3 spawns
    expect(adapter.spawn).toHaveBeenCalledTimes(3)
    // 1 initial verify + 2 repair verifies = 3
    expect(verifier.run).toHaveBeenCalledTimes(3)
    // Should NOT have escalated
    expect(client.submitReview).not.toHaveBeenCalled()
    // Should have advanced
    expect(client.updateFlow).toHaveBeenCalled()
  })
})
