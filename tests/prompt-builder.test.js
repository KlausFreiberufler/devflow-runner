import { describe, it, expect } from 'vitest'
import { buildPrompt, buildRepairPrompt } from '../src/prompt-builder.js'

describe('buildPrompt', () => {
  const baseFlow = {
    id: 'flow-123',
    displayId: 'DF-42',
    summary: 'Add user authentication',
  }

  const baseStep = {}

  it('includes displayId, summary, and devflow_init', () => {
    const result = buildPrompt(baseStep, baseFlow)

    expect(result).toContain('Flow DF-42')
    expect(result).toContain('Add user authentication')
    expect(result).toContain('devflow_init({ flowId: "flow-123" })')
  })

  it('includes skill prompt when provided', () => {
    const step = {
      skill: { prompt: 'Write comprehensive unit tests for all modules.' },
    }
    const result = buildPrompt(step, baseFlow)

    expect(result).toContain('## Instructions')
    expect(result).toContain('Write comprehensive unit tests for all modules.')
  })

  it('includes flow description as context', () => {
    const flow = { ...baseFlow, description: 'This feature adds OAuth2 login.' }
    const result = buildPrompt(baseStep, flow)

    expect(result).toContain('## Context')
    expect(result).toContain('This feature adds OAuth2 login.')
  })

  it('includes tasks as markdown checklist', () => {
    const flow = {
      ...baseFlow,
      tasks: [
        { title: 'Create login endpoint', done: true },
        { title: 'Add JWT validation', done: false },
        { title: 'Write tests', done: false },
      ],
    }
    const result = buildPrompt(baseStep, flow)

    expect(result).toContain('## Tasks')
    expect(result).toContain('- [x] Create login endpoint')
    expect(result).toContain('- [ ] Add JWT validation')
    expect(result).toContain('- [ ] Write tests')
  })

  it('includes previousFeedback when provided', () => {
    const result = buildPrompt(baseStep, baseFlow, {
      previousFeedback: 'Tests are missing edge cases for empty input.',
    })

    expect(result).toContain('## Previous Feedback')
    expect(result).toContain('Tests are missing edge cases for empty input.')
  })

  it('omits optional sections when not provided', () => {
    const result = buildPrompt(baseStep, baseFlow)

    expect(result).not.toContain('## Instructions')
    expect(result).not.toContain('## Context')
    expect(result).not.toContain('## Tasks')
    expect(result).not.toContain('## Previous Feedback')
  })

  it('joins all parts with double newlines', () => {
    const step = { skill: { prompt: 'Do the work.' } }
    const flow = {
      ...baseFlow,
      description: 'Some context.',
      tasks: [{ title: 'Task one', done: false }],
    }
    const result = buildPrompt(step, flow, { previousFeedback: 'Fix it.' })

    // Verify sections are separated by \n\n
    const sections = result.split('\n\n')
    expect(sections.length).toBeGreaterThanOrEqual(5)
  })
})

describe('buildRepairPrompt', () => {
  const flow = {
    id: 'flow-456',
    displayId: 'DF-99',
    summary: 'Fix broken pipeline',
  }

  it('includes error output in a code block', () => {
    const result = buildRepairPrompt('TypeError: x is not a function', [], flow)

    expect(result).toContain('Flow DF-99')
    expect(result).toContain('```\nTypeError: x is not a function\n```')
    expect(result).toContain('Change ONLY what is necessary')
  })

  it('includes verification commands when provided', () => {
    const verifications = [
      { label: 'Unit tests', command: 'npm test' },
      { label: 'Lint', command: 'npm run lint' },
    ]
    const result = buildRepairPrompt('Some error', verifications, flow)

    expect(result).toContain('After fixing, these checks must pass:')
    expect(result).toContain('- Unit tests: `npm test`')
    expect(result).toContain('- Lint: `npm run lint`')
  })

  it('omits verification section when empty', () => {
    const result = buildRepairPrompt('Some error', [], flow)

    expect(result).not.toContain('After fixing, these checks must pass:')
  })

  it('omits verification section when null', () => {
    const result = buildRepairPrompt('Some error', null, flow)

    expect(result).not.toContain('After fixing, these checks must pass:')
  })

  it('includes devflow_init call with flow id', () => {
    const result = buildRepairPrompt('Error', [], flow)

    expect(result).toContain('devflow_init({ flowId: "flow-456" })')
  })
})
