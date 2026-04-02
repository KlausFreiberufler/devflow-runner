import { buildPrompt, buildRepairPrompt } from './prompt-builder.js'
import { Logger } from './utils/logger.js'
import { generateMcpConfig, cleanupMcpConfig } from './utils/mcp-config.js'

const REVIEW_STEPS = ['approval', 'code_review', 'testing']

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
    this.projectPaths = options.projectPaths || {}
    this.log = new Logger(client)
  }

  async runFlow(flowId) {
    let flow = null
    try {
      const init = await this.client.initSession(flowId)
      flow = init.flow || init
      flow.tasks = init.tasks || []
    } catch (err) {
      await this.log.error(`Failed to init session for ${flowId}: ${err.message}`)
      return
    }

    try {
      await this.log.step('🚀', `Starting runner for ${flow.displayId}: "${flow.summary}"`)

      let lastStepKey = null
      let sameStepCount = 0
      let totalIterations = 0
      const MAX_SAME_STEP = 5
      const MAX_TOTAL_ITERATIONS = 20

      while (true) {
        totalIterations++
        if (totalIterations > MAX_TOTAL_ITERATIONS) {
          await this.log.error(`Total iteration limit (${MAX_TOTAL_ITERATIONS}) reached. Stopping.`)
          break
        }

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

        if (step.actor === 'human' || step.actor === 'skip') {
          await this.log.step('⏭', `Skipping step ${step.pipelineStep} (actor: ${step.actor})`)
          await this.client.updateFlow(flowId, { phaseComplete: true })
          continue
        }

        if (step.actor === 'auto' && step.kind === 'terminal') {
          const stateMap = { approval: 'ready', ready: 'in_progress', review: 'done' }
          const nextState = stateMap[step.flowState]
          if (nextState) {
            await this.log.step('⏭', `Auto-transition: ${step.flowState} → ${nextState}`)
            await this.client.updateFlow(flowId, { currentState: nextState })
          } else {
            await this.log.step('⏭', `Skipping terminal step ${step.pipelineStep}`)
            await this.client.updateFlow(flowId, { phaseComplete: true })
          }
          continue
        }

        await this.log.step('⚙️', `Step: ${step.pipelineStep} (phase: ${step.phase}, tool: ${this.adapter.name})`)
        await this.executeStep(step, flow, flowId)

        try { await this.client.touchActivity() } catch {}
      }
    } finally {
      try {
        await this.client.completeSession(`Runner finished for ${flow.displayId}`)
      } catch {}
      this.client.sessionId = null
    }
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

  resolveWorkingDir(flow) {
    const projectId = flow.projectId || flow.project_id
    const entry = this.projectPaths[projectId]
    if (entry?.path) return entry.path
    if (entry && typeof entry === 'string') return entry
    return process.cwd()
  }

  async executeStep(step, flow, flowId) {
    const prompt = buildPrompt(step, flow, {
      previousFeedback: step.previousFeedback,
    })

    if (this.dryRun) {
      await this.log.step('🔍', `[DRY RUN] Would spawn ${this.adapter.name} with ${prompt.length} char prompt`)
      return
    }

    const workingDir = this.resolveWorkingDir(flow)
    if (workingDir === process.cwd()) {
      await this.log.warn(`No project path configured for project ${flow.projectId || flow.project_id}. Using cwd. Run: devflow-runner projects`)
    }

    const mcpConfigPath = generateMcpConfig({
      workingDir,
      apiUrl: this.apiUrl,
      mcpServerCommand: this.mcpServerCommand,
    })

    await this.log.step('🤖', `Spawning ${this.adapter.name} in ${workingDir}...`)
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
        const passed = await this.verifyAndRepair(step, flow, flowId, verifications, mcpConfigPath, workingDir)
        if (!passed) return
      }

      await this.log.step('✅', `Step ${step.pipelineStep} (${step.phase}) complete`)

      // Advance: for review sub-steps, submit a review to mark them complete.
      // For regular steps, phaseComplete handles phase/state advancement.
      try {
        if (REVIEW_STEPS.includes(step.pipelineStep) && this.isLastPhase(step)) {
          const summary = (result.stdout || '').slice(-500) || 'Runner auto-review'
          await this.client.submitReview(flowId, step.pipelineStep, 'approved', summary)
          await this.log.step('📋', `Review submitted for ${step.pipelineStep}`)
        } else {
          const updateResult = await this.client.updateFlow(flowId, { phaseComplete: true })
          await this.log.step('📋', `Phase advanced: ${JSON.stringify(updateResult?.current_state || updateResult?.currentState || 'ok').slice(0, 100)}`)
        }
      } catch (err) {
        await this.log.error(`Step advance failed: ${err.message}`)
      }
    } finally {
      cleanupMcpConfig(mcpConfigPath)
    }
  }

  isLastPhase(step) {
    // If the step has skill phases (pre/action/after), check if current is the last
    // Without detailed phase info, assume action is the last unless after exists
    if (step.phase === 'after') return true
    if (step.phase === 'action' && !step.skill?.afterSkillId) return true
    return false
  }

  async verifyAndRepair(step, flow, flowId, verifications, mcpConfigPath, workingDir) {
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
        workingDir: workingDir || process.cwd(),
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
  const { loadConfig, loadToken, loadProjectPaths } = await import('./utils/config.js')
  const { DevFlowClient } = await import('./client.js')
  const { ClaudeAdapter } = await import('./adapters/claude.js')
  const { Verifier } = await import('./verifier.js')

  const config = loadConfig(options.url ? { apiUrl: options.url } : {})
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
    projectPaths: loadProjectPaths(),
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
 * Watch mode — Socket.IO push + polling fallback.
 */
async function watchMode(client, runner, intervalMs) {
  console.log(`Watch mode started. Press Ctrl+C to stop.`)

  let socketConnected = false
  const activeFlows = new Set()

  const executeFlow = async (flowId) => {
    if (activeFlows.has(flowId)) {
      console.log(`⏳ Flow ${flowId} already running, skipping`)
      return
    }
    if (activeFlows.size > 0) {
      console.log(`⏳ Already executing a flow, queuing ${flowId}`)
      return
    }
    activeFlows.add(flowId)
    try {
      await runner.runFlow(flowId)
      await client.completeRunnerRequest(flowId).catch(() => {})
    } catch (err) {
      console.error(`Failed: ${flowId} — ${err.message}`)
    }
    activeFlows.delete(flowId)
  }

  // Try Socket.IO connection for push-based job delivery
  try {
    const { io } = await import('socket.io-client')
    const config = client.baseUrl
    const token = client.token

    const socket = io(config, {
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      transports: ['websocket', 'polling'],
    })

    socket.on('connect', () => {
      socketConnected = true
      console.log('🔌 Connected to DevFlow (Socket.IO)')
    })

    socket.on('disconnect', (reason) => {
      socketConnected = false
      console.log(`🔌 Disconnected: ${reason}. Reconnecting...`)
    })

    socket.on('runner:execute', async ({ flowId, displayId, summary }) => {
      console.log(`\n📥 Job received: ${displayId || flowId} — ${summary || ''}`)
      await executeFlow(flowId)
    })

    socket.on('connect_error', (err) => {
      if (!socketConnected) {
        console.log(`⚠️  Socket.IO unavailable (${err.message}), using polling fallback`)
      }
    })
  } catch {
    console.log('ℹ️  socket.io-client not available, using polling only')
  }

  // Polling fallback (runs regardless of Socket.IO status)
  console.log(`📡 Polling every ${Math.round(intervalMs / 1000)}s as fallback`)

  const shutdown = () => {
    console.log('\nWatch mode stopped.')
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  while (true) {
    if (activeFlows.size === 0) {
      try {
        await runAll(client, runner)
      } catch (err) {
        console.error(`Poll error: ${err.message}`)
      }
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
}
