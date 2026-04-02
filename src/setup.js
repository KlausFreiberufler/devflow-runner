import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const CONFIG_DIR = join(homedir(), '.devflow')
const CREDENTIALS_PATH = join(CONFIG_DIR, 'runner-credentials.json')
const CONFIG_PATH = join(CONFIG_DIR, 'runner.json')

export async function setup({ token, url }) {
  if (!token) throw new Error('--token is required')

  // Ensure config dir exists
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }

  // Save token
  writeFileSync(CREDENTIALS_PATH, JSON.stringify({ accessToken: token }, null, 2))
  console.log(`✅ Token saved to ${CREDENTIALS_PATH}`)

  // Save config
  const config = { apiUrl: url }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
  console.log(`✅ Config saved to ${CONFIG_PATH}`)

  // Verify connection
  console.log('\n🔍 Verifying connection...')
  try {
    const res = await fetch(`${url}/api/runner/status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json()
    if (res.ok && data.success) {
      console.log('✅ Connected to DevFlow successfully!')
      console.log(`\nStart the runner with: devflow-runner watch`)
    } else {
      console.warn(`⚠️  Connection check returned: ${data.error || 'unknown error'}`)
      console.log('The token was saved. You can try starting the runner with: devflow-runner watch')
    }
  } catch (err) {
    console.warn(`⚠️  Could not reach ${url}: ${err.message}`)
    console.log('The token was saved. Check the URL and try: devflow-runner watch')
  }
}
