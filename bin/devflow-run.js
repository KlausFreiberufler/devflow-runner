#!/usr/bin/env node
import { program } from 'commander'
import { run } from '../src/runner.js'
import { setup } from '../src/setup.js'

program
  .name('devflow-runner')
  .description('Autonomous flow orchestration for DevFlow')
  .version('0.2.1')

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
