#!/usr/bin/env node
import { program } from 'commander'
import { run } from '../src/runner.js'
import { setup } from '../src/setup.js'

program
  .name('devflow-runner')
  .description('Autonomous flow orchestration for DevFlow')
  .version('0.2.2')

program
  .command('setup')
  .description('Configure the runner with a token and API URL')
  .requiredOption('--token <token>', 'Runner API token (from DevFlow Agent Hub)')
  .option('--url <url>', 'DevFlow API URL', 'https://api.app.dev-flow.tech')
  .action(async (options) => {
    try {
      await setup(options)
    } catch (err) {
      console.error('❌', err.message)
      process.exit(1)
    }
  })

program
  .command('watch')
  .description('Watch for new jobs and execute them automatically')
  .option('--url <url>', 'DevFlow API URL (default: from config)')
  .action(async (options) => {
    try {
      await run(null, { ...options, watch: true })
    } catch (err) {
      console.error('❌', err.message)
      process.exit(1)
    }
  })

program
  .command('projects')
  .description('List projects and configure local paths')
  .action(async () => {
    try {
      const { loadConfig, loadToken, loadProjectPaths, saveProjectPath } = await import('../src/utils/config.js')
      const { DevFlowClient } = await import('../src/client.js')
      const { input } = await import('@inquirer/prompts')

      const config = loadConfig()
      const token = loadToken()
      const client = new DevFlowClient(config.apiUrl, token)

      const projects = await client.listProjects()
      const paths = loadProjectPaths()

      console.log('\nProjects:\n')
      for (const p of projects) {
        const existing = paths[p.id]
        const status = existing ? `✅ ${existing.path}` : '❌ no path configured'
        console.log(`  ${p.name} (${p.id})`)
        console.log(`    ${status}`)
      }

      console.log('')
      for (const p of projects) {
        const existing = paths[p.id]
        const answer = await input({
          message: `Path for "${p.name}"${existing ? ` [${existing.path}]` : ''}:`,
          default: existing?.path || '',
        })
        if (answer.trim()) {
          saveProjectPath(p.id, p.name, answer.trim())
          console.log(`  ✅ Saved`)
        }
      }
      console.log('\n✅ Project paths configured.')
    } catch (err) {
      console.error('❌', err.message)
      process.exit(1)
    }
  })

program
  .command('run [flow-id]', { isDefault: true })
  .description('Run a specific flow or pick interactively')
  .option('--all', 'Run all flows with runner_requested flag')
  .option('--tool <tool>', 'Override tool adapter (default: claude)')
  .option('--until-gate', 'Run until next human gate, then exit')
  .option('--url <url>', 'DevFlow API URL (default: from config)')
  .option('--dry-run', 'Show what would happen without executing')
  .action(async (flowId, options) => {
    try {
      await run(flowId, options)
    } catch (err) {
      console.error('❌', err.message)
      process.exit(1)
    }
  })

program.parse()
