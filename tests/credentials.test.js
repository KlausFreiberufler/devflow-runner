import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('Credentials Separation', () => {
  describe('config.js paths', () => {
    it('should use runner-credentials.json, NOT credentials.json', () => {
      const source = readFileSync(
        join(import.meta.dirname, '../src/utils/config.js'), 'utf-8'
      )
      expect(source).toContain('runner-credentials.json')
      // Every CREDENTIALS_PATH assignment must reference runner-credentials.json
      const defLine = source.split('\n').find(l => l.startsWith('const CREDENTIALS_PATH'))
      expect(defLine).toBeTruthy()
      expect(defLine).toContain('runner-credentials.json')
    })
  })

  describe('setup.js paths', () => {
    it('should save token to runner-credentials.json, NOT credentials.json', () => {
      const source = readFileSync(
        join(import.meta.dirname, '../src/setup.js'), 'utf-8'
      )
      expect(source).toContain('runner-credentials.json')
      const defLine = source.split('\n').find(l => l.startsWith('const CREDENTIALS_PATH'))
      expect(defLine).toBeTruthy()
      expect(defLine).toContain('runner-credentials.json')
    })
  })

  describe('loadToken', () => {
    it('should prefer DEVFLOW_TOKEN env var', async () => {
      process.env.DEVFLOW_TOKEN = 'dfr_env_test_token'
      const { loadToken } = await import('../src/utils/config.js')
      expect(loadToken()).toBe('dfr_env_test_token')
      delete process.env.DEVFLOW_TOKEN
    })

    it('should fall back to runner-credentials.json file', async () => {
      delete process.env.DEVFLOW_TOKEN
      const { loadToken } = await import('../src/utils/config.js')
      const token = loadToken()
      expect(token).toMatch(/^dfr_/)
    })

    it('should throw helpful error mentioning devflow-runner setup', () => {
      const source = readFileSync(
        join(import.meta.dirname, '../src/utils/config.js'), 'utf-8'
      )
      expect(source).toContain('devflow-runner setup')
    })
  })
})

describe('Prompt Builder - task_update instruction', () => {
  it('should include task_update instruction in the prompt', async () => {
    const { buildPrompt } = await import('../src/prompt-builder.js')

    const step = { pipelineStep: 'implementation', phase: 'action', skill: null }
    const flow = {
      id: 'flow-123',
      displayId: 'DF-99',
      summary: 'Test Flow',
      tasks: [
        { title: 'Task 1', done: false },
        { title: 'Task 2', done: false },
      ],
    }

    const prompt = buildPrompt(step, flow)
    expect(prompt).toContain('task_update')
  })
})
