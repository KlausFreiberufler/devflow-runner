/**
 * Builds prompts for AI agent sessions based on flow state and pipeline steps.
 */

export function buildPrompt(step, flow, options = {}) {
  const parts = []

  // Header
  parts.push(`You are working on Flow ${flow.displayId}: "${flow.summary}"`)

  // Skill instructions
  if (step.skill?.prompt) {
    parts.push(`## Instructions\n${step.skill.prompt}`)
  }

  // Flow context
  if (flow.description) {
    parts.push(`## Context\n${flow.description}`)
  }

  // Tasks as markdown checklist
  if (flow.tasks?.length) {
    const checklist = flow.tasks
      .map(t => `- [${t.done ? 'x' : ' '}] ${t.title}`)
      .join('\n')
    parts.push(`## Tasks\n${checklist}`)
  }

  // Previous feedback from rejected review
  if (options.previousFeedback) {
    parts.push(`## Previous Feedback\n${options.previousFeedback}`)
  }

  // Always: devflow_init reminder + task tracking
  parts.push(
    `## Important\nStart by calling devflow_init({ flowId: "${flow.id}" }) to initialize your session.\nFor each task you complete, call task_update to mark it as done.\nAll your work will be tracked in DevFlow.`
  )

  return parts.join('\n\n')
}

export function buildRepairPrompt(errorOutput, verifications, flow) {
  const parts = []

  parts.push(
    `Your previous work on Flow ${flow.displayId} produced errors:\n\n\`\`\`\n${errorOutput}\n\`\`\`\n\nFix these errors. Change ONLY what is necessary. Do not refactor unrelated code.`
  )

  if (verifications?.length) {
    const checks = verifications
      .map(v => `- ${v.label}: \`${v.command}\``)
      .join('\n')
    parts.push(`After fixing, these checks must pass:\n${checks}`)
  }

  parts.push(
    `Start by calling devflow_init({ flowId: "${flow.id}" }) to initialize your session.`
  )

  return parts.join('\n\n')
}
