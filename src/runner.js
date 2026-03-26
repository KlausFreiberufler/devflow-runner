import { buildPrompt, buildRepairPrompt } from './prompt-builder.js'
import { Logger } from './utils/logger.js'

export class Runner {
  constructor(client, adapter, verifier, options = {}) {
    this.client = client
    this.adapter = adapter
    this.verifier = verifier
    this.maxRetries = options.maxRetries || 3
    this.untilGate = options.untilGate || false
    this.dryRun = options.dryRun || false
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

    await this.log.step('🤖', `Spawning ${this.adapter.name}...`)
    const result = await this.adapter.spawn(prompt, {
      model: step.skill?.agentModel || 'sonnet',
      mcpConfig: this.getMcpConfigPath(),
      workingDir: process.cwd(),
    })

    if (result.exitCode !== 0) {
      await this.log.warn(`${this.adapter.name} exited with code ${result.exitCode}`)
    }

    const verifications = step.skill?.verificationsJson || []
    if (verifications.length > 0) {
      const passed = await this.verifyAndRepair(step, flow, flowId, verifications)
      if (!passed) return
    }

    await this.log.step('✅', `Step ${step.pipelineStep} (${step.phase}) complete`)
    await this.client.updateFlow(flowId, { phaseComplete: true })
  }

  async verifyAndRepair(step, flow, flowId, verifications) {
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
        mcpConfig: this.getMcpConfigPath(),
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

  getMcpConfigPath() {
    return '.mcp.json'
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
  })

  if (flowId) {
    const resolvedId = await client.resolveFlowId(flowId)
    await runner.runFlow(resolvedId)
  } else if (options.all) {
    console.log('--all mode not yet implemented (Phase 2)')
  } else if (options.watch) {
    console.log('--watch mode not yet implemented (Phase 2)')
  } else {
    console.error('Please provide a flow ID or use --all / --watch')
    process.exit(1)
  }
}
