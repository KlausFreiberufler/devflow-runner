import { select } from '@inquirer/prompts'

const RUNNABLE_STATES = ['ready', 'in_progress', 'planning', 'idea']

/**
 * Interactive selection wizard for devflow-run without arguments.
 * Guides the user through: Project → Flow → Tool.
 *
 * @param {import('./client.js').DevFlowClient} client
 * @param {string[]} availableTools — adapter names, e.g. ['claude']
 * @returns {Promise<{ flowId: string, tool: string }>}
 */
export async function interactiveSelect(client, availableTools = ['claude']) {
  // 1. Select project
  const projects = await client.listProjects()
  if (!projects?.length) {
    throw new Error('Keine Projekte gefunden. Erstelle zuerst ein Projekt in DevFlow.')
  }

  const project = await select({
    message: 'Projekt wählen:',
    choices: projects.map(p => ({
      name: `${p.name}${p.repo_url ? ` (${p.repo_url})` : ''}`,
      value: p,
    })),
  })

  // 2. Select flow
  const allFlows = await client.listFlows({ projectId: project.id })
  const flows = (Array.isArray(allFlows) ? allFlows : [])
    .filter(f => RUNNABLE_STATES.includes(f.state || f.current_state))

  if (!flows.length) {
    throw new Error(`Keine offenen Flows in Projekt "${project.name}". Erstelle zuerst einen Flow.`)
  }

  const flow = await select({
    message: 'Flow wählen:',
    choices: flows.map(f => ({
      name: `${f.displayId || f.display_id} — ${f.summary} [${f.state || f.current_state}]`,
      value: f,
    })),
  })

  // 3. Select tool (skip if only one)
  let tool = availableTools[0]
  if (availableTools.length > 1) {
    tool = await select({
      message: 'KI-Tool wählen:',
      choices: availableTools.map(t => ({ name: t, value: t })),
    })
  }

  return { flowId: flow.id, tool }
}
