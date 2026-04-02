import { describe, it, expect, vi } from 'vitest'

/**
 * Watch mode uses a boolean `busy` flag that can race between socket push and poll.
 * After fix, it should use a Set<flowId> to track in-flight flows.
 *
 * We test the watchMode function indirectly by checking the source code pattern,
 * since it requires Socket.IO mocking for full integration tests.
 */
describe('Watch Mode — Race Condition Protection', () => {
  it('should use a Set or Map for in-flight tracking, not a boolean', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const source = readFileSync(join(import.meta.dirname, '../src/runner.js'), 'utf-8')

    // Extract the watchMode function
    const watchStart = source.indexOf('async function watchMode')
    const watchEnd = source.indexOf('\n}', source.indexOf('while (true)', watchStart)) + 2
    const watchBody = source.slice(watchStart, watchEnd)

    // Should NOT use a simple boolean `busy` flag
    expect(watchBody).not.toMatch(/let busy\s*=\s*false/)
    // Should use a Set or similar for tracking
    expect(watchBody).toMatch(/new Set|inFlight|activeFlows/)
  })
})

describe('Loop Protection — Total Iterations', () => {
  it('should have a total iteration limit beyond same-step detection', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const source = readFileSync(join(import.meta.dirname, '../src/runner.js'), 'utf-8')

    // Should have both MAX_SAME_STEP and MAX_TOTAL_ITERATIONS
    expect(source).toContain('MAX_SAME_STEP')
    expect(source).toMatch(/MAX_TOTAL|totalIterations|maxIterations/i)
  })

  it('should stop after total iteration limit', async () => {
    const { Runner } = await import('../src/runner.js')

    // Create a mock that oscillates between two different steps
    let callCount = 0
    const client = {
      initSession: vi.fn().mockResolvedValue({
        flow: { id: 'f-1', displayId: 'DF-99', summary: 'Test', projectId: 'p-1' },
        tasks: [],
      }),
      getNextStep: vi.fn().mockImplementation(() => {
        callCount++
        // Alternate between two steps — same-step counter resets each time
        if (callCount % 2 === 1) {
          return {
            flowState: 'in_progress', pipelineStep: 'implementation', phase: 'action',
            actor: 'agent', gate: { blocked: false },
            skill: { prompt: 'A', name: 'test' },
          }
        }
        return {
          flowState: 'in_progress', pipelineStep: 'implementation', phase: 'after',
          actor: 'agent', gate: { blocked: false },
          skill: { prompt: 'B', name: 'test' },
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
      name: 'test-adapter',
      spawn: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'done', stderr: '' }),
    }
    const verifier = {
      run: vi.fn().mockResolvedValue({ allPassed: true, skipped: true, results: [], failures: [] }),
    }

    const runner = new Runner(client, adapter, verifier, { dryRun: true })
    await runner.runFlow('f-1')

    // Should have stopped before exhausting all possible iterations
    // With oscillating steps, same-step counter never triggers,
    // so total iteration limit must kick in
    expect(callCount).toBeLessThanOrEqual(25) // MAX_TOTAL should be ~20
  })
})
