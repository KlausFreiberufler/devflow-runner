import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock @inquirer/prompts before importing
vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
}))

import { interactiveSelect } from '../src/interactive.js'
import { select } from '@inquirer/prompts'

beforeEach(() => {
  select.mockReset()
})

function createMockClient(overrides = {}) {
  return {
    listProjects: vi.fn().mockResolvedValue([
      { id: 'p-1', name: 'Project Alpha', repo_url: 'github.com/org/alpha' },
      { id: 'p-2', name: 'Project Beta' },
    ]),
    listFlows: vi.fn().mockResolvedValue([
      { id: 'f-1', displayId: 'DF-10', summary: 'Login Feature', state: 'ready' },
      { id: 'f-2', displayId: 'DF-11', summary: 'Auth Bug', state: 'in_progress' },
      { id: 'f-3', displayId: 'DF-12', summary: 'Archived', state: 'done' },
    ]),
    ...overrides,
  }
}

describe('interactiveSelect', () => {
  it('should guide through project → flow → tool and return selection', async () => {
    const client = createMockClient()

    // First select call: project, second: flow
    select
      .mockResolvedValueOnce({ id: 'p-1', name: 'Project Alpha' })
      .mockResolvedValueOnce({ id: 'f-1', displayId: 'DF-10', summary: 'Login Feature' })

    const result = await interactiveSelect(client, ['claude'])

    expect(client.listProjects).toHaveBeenCalled()
    expect(client.listFlows).toHaveBeenCalledWith({ projectId: 'p-1' })
    expect(result).toEqual({ flowId: 'f-1', tool: 'claude' })
  })

  it('should show tool selector when multiple tools available', async () => {
    const client = createMockClient()

    select
      .mockResolvedValueOnce({ id: 'p-1', name: 'Project Alpha' })
      .mockResolvedValueOnce({ id: 'f-2', displayId: 'DF-11' })
      .mockResolvedValueOnce('codex')

    const result = await interactiveSelect(client, ['claude', 'codex'])

    expect(select).toHaveBeenCalledTimes(3)
    expect(result.tool).toBe('codex')
  })

  it('should skip tool selection with single tool', async () => {
    const client = createMockClient()

    select
      .mockResolvedValueOnce({ id: 'p-2', name: 'Project Beta' })
      .mockResolvedValueOnce({ id: 'f-1', displayId: 'DF-10' })

    const result = await interactiveSelect(client, ['claude'])

    // Only 2 select calls (project + flow), no tool select
    expect(select).toHaveBeenCalledTimes(2)
    expect(result.tool).toBe('claude')
  })

  it('should filter out done/non-runnable flows', async () => {
    const client = createMockClient()

    select
      .mockResolvedValueOnce({ id: 'p-1', name: 'Project Alpha' })
      .mockResolvedValueOnce({ id: 'f-1' })

    await interactiveSelect(client, ['claude'])

    // Check that the flow choices passed to select exclude 'done' flows
    const flowSelectCall = select.mock.calls[1][0]
    const flowChoiceIds = flowSelectCall.choices.map(c => c.value.id)
    expect(flowChoiceIds).toContain('f-1')
    expect(flowChoiceIds).toContain('f-2')
    expect(flowChoiceIds).not.toContain('f-3') // done flow filtered out
  })

  it('should throw if no projects found', async () => {
    const client = createMockClient({
      listProjects: vi.fn().mockResolvedValue([]),
    })

    await expect(interactiveSelect(client, ['claude'])).rejects.toThrow('Keine Projekte gefunden')
  })

  it('should throw if no runnable flows found', async () => {
    const client = createMockClient({
      listFlows: vi.fn().mockResolvedValue([
        { id: 'f-3', displayId: 'DF-12', summary: 'Archived', state: 'done' },
      ]),
    })

    select.mockResolvedValueOnce({ id: 'p-1', name: 'Project Alpha' })

    await expect(interactiveSelect(client, ['claude'])).rejects.toThrow('Keine offenen Flows')
  })
})
