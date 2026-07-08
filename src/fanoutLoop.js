/**
 * DF-452 — Runner fan-out loop (part B of sub-agent decomposition).
 *
 * Consumes the conductor plan (DF-451): when a flow decomposes into per-task
 * specs, run one scoped worker per task instead of one monolithic agent. Small
 * scope = less drift. Sequential (concurrency 1) to respect the Max rate limit
 * and stay deterministic. Pure sequencing — the actual spawn is injected via
 * `runWorker`, so this is unit-testable without a real `claude`.
 */

/** True only when the plan is a real per-task decomposition. Never throws. */
export function shouldFanOut(plan) {
  return !!(plan && plan.mode === 'per-task' && Array.isArray(plan.specs) && plan.specs.length >= 1)
}

/**
 * Run each spec through the injected worker, sequentially, stopping early once
 * `maxFailures` workers have failed (leave the flow for a human — no silent
 * push-through). Never throws (a throwing worker counts as a failure).
 *
 * @param {{specs: any[], runWorker: (spec:any)=>Promise<{taskId?:any, ok?:boolean, reason?:string}>, maxFailures?: number}} opts
 * @returns {Promise<{allDone:boolean, completed:any[], failed:{taskId:any,reason:string}[]}>}
 */
export async function runFanOut({ specs, runWorker, maxFailures = 1 } = {}) {
  const list = Array.isArray(specs) ? specs : []
  const completed = []
  const failed = []

  for (const spec of list) {
    let r
    try {
      r = await runWorker(spec)
    } catch (e) {
      r = { ok: false, reason: (e && e.message) || 'worker_threw' }
    }
    const taskId = (r && Object.prototype.hasOwnProperty.call(r, 'taskId')) ? r.taskId : (spec ? spec.taskId : null)
    if (r && r.ok) {
      completed.push(taskId ?? null)
    } else {
      failed.push({ taskId: taskId ?? null, reason: (r && r.reason) || 'failed' })
      if (failed.length >= maxFailures) break // early stop — do not run further workers
    }
  }

  const allDone = list.length > 0 && failed.length === 0 && completed.length === list.length
  return { allDone, completed, failed }
}
