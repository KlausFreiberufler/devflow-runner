// Placeholder — wird in Task 7 vollständig implementiert
export async function run(flowId, options = {}) {
  if (!flowId && !options.all && !options.watch) {
    console.error('Please provide a flow ID or use --all / --watch')
    process.exit(1)
  }
  console.log(`🚀 devflow-run v0.1.0`)
  console.log(`Flow: ${flowId || '(all)'}`)
  console.log(`Options:`, options)
  console.log('Runner not yet implemented — see Task 7')
}
