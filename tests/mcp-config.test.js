import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { generateMcpConfig, cleanupMcpConfig } from '../src/utils/mcp-config.js'

describe('generateMcpConfig', () => {
  let generatedPaths = []

  afterEach(() => {
    for (const p of generatedPaths) {
      cleanupMcpConfig(p)
    }
    generatedPaths = []
  })

  it('should generate a valid JSON file with correct structure', () => {
    const path = generateMcpConfig({
      workingDir: '/projects/my-app',
      apiUrl: 'https://api.dev-flow.tech',
    })
    generatedPaths.push(path)

    expect(existsSync(path)).toBe(true)
    const config = JSON.parse(readFileSync(path, 'utf-8'))

    expect(config.mcpServers.devflow).toBeDefined()
    expect(config.mcpServers.devflow.command).toBe('npx')
    expect(config.mcpServers.devflow.args).toEqual(['devflow-mcp'])
    expect(config.mcpServers.devflow.env.DEVFLOW_URL).toBe('https://api.dev-flow.tech')
    expect(config.mcpServers.devflow.env.DEVFLOW_WORKING_DIR).toBe('/projects/my-app')
  })

  it('should split multi-word commands into command + args', () => {
    const path = generateMcpConfig({
      workingDir: '/projects/app',
      apiUrl: 'https://api.test',
      mcpServerCommand: 'node /path/to/server.js --stdio',
    })
    generatedPaths.push(path)

    const config = JSON.parse(readFileSync(path, 'utf-8'))
    expect(config.mcpServers.devflow.command).toBe('node')
    expect(config.mcpServers.devflow.args).toEqual(['/path/to/server.js', '--stdio'])
  })

  it('should handle single-word commands', () => {
    const path = generateMcpConfig({
      workingDir: '/test',
      apiUrl: 'https://api.test',
      mcpServerCommand: 'devflow-mcp',
    })
    generatedPaths.push(path)

    const config = JSON.parse(readFileSync(path, 'utf-8'))
    expect(config.mcpServers.devflow.command).toBe('devflow-mcp')
    expect(config.mcpServers.devflow.args).toEqual([])
  })

  it('should generate unique file paths per call', () => {
    const path1 = generateMcpConfig({ workingDir: '/a', apiUrl: 'https://x' })
    const path2 = generateMcpConfig({ workingDir: '/b', apiUrl: 'https://x' })
    generatedPaths.push(path1, path2)

    expect(path1).not.toBe(path2)
  })
})

describe('cleanupMcpConfig', () => {
  it('should remove the generated file', () => {
    const path = generateMcpConfig({
      workingDir: '/test',
      apiUrl: 'https://api.test',
    })

    expect(existsSync(path)).toBe(true)
    cleanupMcpConfig(path)
    expect(existsSync(path)).toBe(false)
  })

  it('should not throw if file does not exist', () => {
    expect(() => cleanupMcpConfig('/nonexistent/path.json')).not.toThrow()
  })
})
