import { readFileSync, writeFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const CONFIG_PATH = join(homedir(), '.devflow', 'runner.json')
const CREDENTIALS_PATH = join(homedir(), '.devflow', 'runner-credentials.json')

export function loadConfig(overrides = {}) {
  const defaults = {
    apiUrl: 'https://api.app.dev-flow.tech',
    pollInterval: 60000,
    defaultAdapter: 'claude',
    maxRetries: 3,
    spawnTimeout: 30 * 60 * 1000,
    mcpServerCommand: 'npx devflow-mcp',
  }

  let fileConfig = {}
  if (existsSync(CONFIG_PATH)) {
    fileConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
  }

  // Filter out undefined values so they don't override defaults/fileConfig
  const cleanOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([, v]) => v !== undefined)
  )

  return { ...defaults, ...fileConfig, ...cleanOverrides }
}

export function loadToken() {
  if (process.env.DEVFLOW_TOKEN) return process.env.DEVFLOW_TOKEN

  if (existsSync(CREDENTIALS_PATH)) {
    const creds = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf-8'))
    if (creds.accessToken) return creds.accessToken
  }

  throw new Error('No DevFlow token found. Set DEVFLOW_TOKEN or run devflow-runner setup first.')
}

export function loadProjectPaths() {
  if (!existsSync(CONFIG_PATH)) return {}
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
  return config.projectPaths || {}
}

export function saveProjectPath(projectId, projectName, localPath) {
  let config = {}
  if (existsSync(CONFIG_PATH)) {
    config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
  }
  if (!config.projectPaths) config.projectPaths = {}
  config.projectPaths[projectId] = { name: projectName, path: localPath }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}
