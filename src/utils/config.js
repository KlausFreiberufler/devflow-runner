import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const CONFIG_PATH = join(homedir(), '.devflow', 'runner.json')
const CREDENTIALS_PATH = join(homedir(), '.devflow', 'credentials.json')

export function loadConfig(overrides = {}) {
  const defaults = {
    apiUrl: 'https://api.app.dev-flow.tech',
    pollInterval: 60000,
    defaultAdapter: 'claude',
    maxRetries: 3,
    spawnTimeout: 30 * 60 * 1000,
  }

  let fileConfig = {}
  if (existsSync(CONFIG_PATH)) {
    fileConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
  }

  return { ...defaults, ...fileConfig, ...overrides }
}

export function loadToken() {
  if (process.env.DEVFLOW_TOKEN) return process.env.DEVFLOW_TOKEN

  if (existsSync(CREDENTIALS_PATH)) {
    const creds = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf-8'))
    if (creds.accessToken) return creds.accessToken
  }

  throw new Error('No DevFlow token found. Set DEVFLOW_TOKEN or run devflow-mcp setup first.')
}
