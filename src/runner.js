import { buildPrompt, buildRepairPrompt } from './prompt-builder.js'
import { Logger } from './utils/logger.js'
import { generateMcpConfig, cleanupMcpConfig } from './utils/mcp-config.js'

export class Runner {
  constructor(client, adapter, verifier, options = {}) {
    this.client = client
    this.adapter = adapter
    this.verifier = verifier
    this.maxRetries = options.maxRetries || 3
    this.untilGate = options.untilGate || false
    this.dryRun = options.dryRun || false
    this.mcpServerCommand = options.mcpServerCommand || 'npx devflow-mcp'
    this.apiUrl = options.apiUrl || 'https://api.app.dev-flow.tech'
    this.log = new Logger(client)
  }

  async runFlow(flowId) {
    const init = await this.client.initSession(flowId)
    const flow = init.flow || init
    flow.tasks = init.tasks || []

    await this.log.step('🚀', `Starting runner for ${flow.displayId}: "${flow.summary}"`)

    let lastStepKey = null
    let sameStepCount = 0
    const MAX_SAME_STEP = 5

    while (true) {
      const step = await this.client.getNextStep(flowId)

      // Loop protection: detect if we're stuck on the same step
      const stepKey = `${step.flowState}:${step.pipelineStep}:${step.phase}`
      if (stepKey === lastStepKey) {
        sameStepCount++
        if (sameStepCount >= MAX_SAME_STEP) {
          await this.log.error(`Stuck on step ${stepKey} for ${MAX_SAME_STEP} iterations. Stopping.`)
          break
        }
      } else {
        sameStepCount = 0
        lastStepKey = stepKey
      }

      if (step.flowState === 'done') {
        await this.log.step('🎉', `Flow ${flow.displayId} completed!`)
        break
      }

      if (step.gate?.blocked) {
        const handled = await this.handleGate(step, flowId)
        if (!handled) break
        continue
      }

      if (step.actor === 'human' || step.actor === 'skip' || step.actor === 'auto') {
        await this.log.step('⏭', `Skipping step ${step.pipelineStep} (actor: ${step.actor})`)
        await this.client.updateFlow(flowId, { phaseComplete: true })
        continue
      }

      await this.log.step('⚙️', `Step: ${step.pipelineStep} (phase: ${step.phase}, tool: ${this.adapter.name})`)
      await this.executeStep(step, flow, flowId)

      try { await this.client.touchActivity() } catch {}
    }

    try {
      await this.client.completeSession(`Runner finished for ${flow.displayId}`)
    } catch {}
  }

  async handleGate(step, flowId) {
    if (step.transitionPolicy === 'human_only') {
      if (this.untilGate) {
        await this.log.step('⏸', `Gate reached (${step.pipelineStep}). Exiting (--until-gate).`)
        return false
      }
      await this.log.step('⏸', `Waiting for approval (${step.pipelineStep})...`)
      await this.waitForGate(flowId)
      return true
    }

    await this.log.step('✅', `Auto-advancing gate: ${step.pipelineStep}`)
    await this.client.updateFlow(flowId, { phaseComplete: true })
    return true
  }

  async executeStep(step, flow, flowId) {
    const prompt = buildPrompt(step, flow, {
      previousFeedback: step.previousFeedback,
    })

    if (this.dryRun) {
      await this.log.step('🔍', `[DRY RUN] Would spawn ${this.adapter.name} with ${prompt.length} char prompt`)
      return  // Don't call API in dry-run — just log and return
    }

    const workingDir = process.cwd()
    const mcpConfigPath = generateMcpConfig({
      workingDir,
      apiUrl: this.apiUrl,
      mcpServerCommand: this.mcpServerCommand,
    })

    await this.log.step('🤖', `Spawning ${this.adapter.name}...`)
    try {
      const result = await this.adapter.spawn(prompt, {
        model: step.skill?.agentModel || 'sonnet',
        mcpConfig: mcpConfigPath,
        workingDir,
      })

      if (result.exitCode !== 0) {
        const errSnippet = (result.stderr || result.stdout || '').slice(-500)
        await this.log.warn(`${this.adapter.name} exited with code ${result.exitCode}: ${errSnippet}`)
        if (!result.stdout?.trim()) {
          await this.log.error(`${this.adapter.name} produced no output. Skipping phase advance.`)
          return
        }
      }

      const verifications = step.skill?.verificationsJson || []
      if (verifications.length > 0) {
        const passed = await this.verifyAndRepair(step, flow, flowId, verifications, mcpConfigPath)
        if (!passed) return
      }

      await this.log.step('✅', `Step ${step.pipelineStep} (${step.phase}) complete`)
      try {
        const updateResult = await this.client.updateFlow(flowId, { phaseComplete: true })
        await this.log.step('📋', `Phase advanced: ${JSON.stringify(updateResult?.current_state || updateResult?.currentState || 'ok').slice(0, 100)}`)
      } catch (err) {
        await this.log.error(`Phase advance failed: ${err.message}`)
      }
    } finally {
      cleanupMcpConfig(mcpConfigPath)
    }
  }

  async verifyAndRepair(step, flow, flowId, verifications, mcpConfigPath) {
    await this.log.step('🧪', 'Running verifications...')
    let checks = await this.verifier.run(verifications)

    this.logCheckResults(checks)

    if (checks.allPassed) return true

    const maxRetries = step.maxRetries || this.maxRetries

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      await this.log.step('🔄', `Repair attempt ${attempt}/${maxRetries}`)

      const errorOutput = checks.failures
        .map(f => `${f.label}: ${f.output || f.error || 'FAILED'}`)
        .join('\n')

      const repairPrompt = buildRepairPrompt(errorOutput, verifications, flow)

      await this.adapter.spawn(repairPrompt, {
        model: step.skill?.agentModel || 'sonnet',
        mcpConfig: mcpConfigPath,
        workingDir: process.cwd(),
      })

      checks = await this.verifier.run(verifications)
      this.logCheckResults(checks)

      if (checks.allPassed) {
        await this.log.step('✅', `Repair successful on attempt ${attempt}`)
        await this.client.updateFlow(flowId, { phaseComplete: true })
        return true
      }
    }

    await this.log.error(`Max retries (${maxRetries}) reached. Escalating to human.`)
    const errorSummary = checks.failures.map(f => f.label).join(', ')
    await this.client.submitReview(flowId, step.pipelineStep, 'rejected',
      `Runner failed after ${maxRetries} attempts. Failing checks: ${errorSummary}`)
    return false
  }

  async logCheckResults(checks) {
    for (const r of checks.results || []) {
      await this.log.step(r.passed ? '✅' : '❌', `${r.label}: ${r.passed ? 'PASS' : 'FAIL'}`)
    }
  }

  async waitForGate(flowId) {
    const pollInterval = 30000
    while (true) {
      await new Promise(r => setTimeout(r, pollInterval))
      const step = await this.client.getNextStep(flowId)
      if (!step.gate?.blocked) return
      try { await this.client.touchActivity() } catch {}
    }
  }

}

export async function run(flowId, options = {}) {
  const { loadConfig, loadToken } = await import('./utils/config.js')
  const { DevFlowClient } = await import('./client.js')
  const { ClaudeAdapter } = await import('./adapters/claude.js')
  const { Verifier } = await import('./verifier.js')

  const config = loadConfig({ apiUrl: options.url })
  const token = loadToken()

  const client = new DevFlowClient(config.apiUrl, token)
  const adapter = new ClaudeAdapter()
  const verifier = new Verifier()

  const runner = new Runner(client, adapter, verifier, {
    maxRetries: config.maxRetries,
    untilGate: options.untilGate,
    dryRun: options.dryRun,
    mcpServerCommand: config.mcpServerCommand,
    apiUrl: config.apiUrl,
  })

  if (flowId) {
    const resolvedId = await client.resolveFlowId(flowId)
    await runner.runFlow(resolvedId)
    await client.completeRunnerRequest(resolvedId).catch(() => {})
  } else if (options.all) {
    await runAll(client, runner)
  } else if (options.watch) {
    await watchMode(client, runner, config.pollInterval || 60000)
  } else {
    // Interactive mode: Project → Flow → Tool wizard
    const { interactiveSelect } = await import('./interactive.js')
    const selection = await interactiveSelect(client, ['claude'])
    const resolvedId = await client.resolveFlowId(selection.flowId)
    await runner.runFlow(resolvedId)
    await client.completeRunnerRequest(resolvedId).catch(() => {})
  }
}

/**
 * Run all flows in the runner queue (runner_requested=1).
 */
async function runAll(client, runner) {
  const queue = await client.getRunnerQueue()
  const flows = Array.isArray(queue) ? queue : []

  if (flows.length === 0) {
    console.log('No flows in runner queue.')
    return
  }

  console.log(`Found ${flows.length} flow(s) in runner queue.`)

  for (const flow of flows) {
    const displayId = flow.displayId || flow.display_id || flow.id
    console.log(`\nStarting: ${displayId} — ${flow.ticketSummary || flow.ticket_summary}`)
    try {
      await runner.runFlow(flow.id)
      await client.completeRunnerRequest(flow.id).catch(() => {})
      console.log(`Completed: ${displayId}`)
    } catch (err) {
      console.error(`Failed: ${displayId} — ${err.message}`)
    }
  }

  console.log(`\nDone. Processed ${flows.length} flow(s).`)
}

/**
 * Watch mode — poll for new runner-requested flows every N ms.
 */
async function watchMode(client, runner, intervalMs) {
  console.log(`Watch mode started (polling every ${Math.round(intervalMs / 1000)}s). Press Ctrl+C to stop.`)

  const shutdown = () => {
    console.log('\nWatch mode stopped.')
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  while (true) {
    try {
      await runAll(client, runner)
    } catch (err) {
      console.error(`Poll error: ${err.message}`)
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
}
