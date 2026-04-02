import { writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'

/**
 * Generates a temporary .mcp.json with the correct working directory
 * and MCP server command. Returns the path to the temp file.
 *
 * @param {object} options
 * @param {string} options.workingDir — the target project's working directory
 * @param {string} options.apiUrl — DevFlow API URL
 * @param {string} [options.mcpServerCommand] — command to start the MCP server (default: npx devflow-mcp)
 * @returns {string} path to the generated temp .mcp.json
 */
export function generateMcpConfig({ workingDir, apiUrl, mcpServerCommand = 'npx devflow-mcp' }) {
  const parts = mcpServerCommand.split(/\s+/)
  const command = parts[0]
  const commandArgs = parts.slice(1)

  const config = {
    mcpServers: {
      devflow: {
        command,
        args: commandArgs,
        env: {
          DEVFLOW_URL: apiUrl,
          DEVFLOW_WORKING_DIR: workingDir,
        },
      },
    },
  }

  const tempPath = join(tmpdir(), `devflow-mcp-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}.json`)
  writeFileSync(tempPath, JSON.stringify(config, null, 2))
  return tempPath
}

/**
 * Remove a previously generated temp MCP config file.
 *
 * @param {string} configPath
 */
export function cleanupMcpConfig(configPath) {
  try {
    unlinkSync(configPath)
  } catch {
    // File already cleaned up or never written — ignore
  }
}
