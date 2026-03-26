import { spawn } from 'node:child_process';
import { BaseAdapter } from './base.js';

export class ClaudeAdapter extends BaseAdapter {
  constructor() {
    super('claude');
  }

  buildArgs(prompt, config = {}) {
    const args = [
      '--model', config.model || 'sonnet',
      '-p', prompt,
    ];

    if (config.mcpConfig) {
      args.push('--mcp-config', config.mcpConfig);
    }

    return args;
  }

  spawn(prompt, config = {}) {
    const args = this.buildArgs(prompt, config);
    const timeout = config.timeout || 30 * 60 * 1000; // 30 minutes
    const cwd = config.workingDir || process.cwd();

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const child = spawn('claude', args, { cwd });

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`claude process timed out after ${timeout}ms`));
      }, timeout);

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        if (err.code === 'ENOENT') {
          reject(new Error(
            'Claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code'
          ));
        } else {
          reject(err);
        }
      });

      child.on('close', (exitCode) => {
        clearTimeout(timer);
        resolve({ exitCode, stdout, stderr });
      });
    });
  }
}
