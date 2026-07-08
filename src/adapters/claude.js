import { spawn } from 'node:child_process';
import { BaseAdapter } from './base.js';

export class ClaudeAdapter extends BaseAdapter {
  constructor() {
    super('claude');
  }

  // Map full model IDs to Claude CLI short names
  resolveModel(model) {
    if (!model) return 'sonnet';
    const map = {
      'claude-opus-4-8': 'opus',
      'claude-opus-4-7': 'opus',
      'claude-opus-4-6': 'opus',
      'claude-sonnet-5': 'sonnet',
      'claude-sonnet-4-6': 'sonnet',
      'claude-sonnet-4': 'sonnet',
      'claude-haiku-4-5': 'haiku',
      'claude-haiku-4-5-20251001': 'haiku',
    };
    return map[model] || model;
  }

  buildArgs(prompt, config = {}) {
    const args = [
      '--model', this.resolveModel(config.model),
      '-p', prompt,
    ];

    if (config.mcpConfig) {
      args.push('--mcp-config', config.mcpConfig);
    }

    return args;
  }

  /**
   * DF-449 — Build the child-process env for the requested executor mode.
   * The `claude` CLI uses the logged-in Claude session (e.g. a Max subscription,
   * flat-rate) UNLESS ANTHROPIC_API_KEY is present, in which case it bills the
   * metered API. So the mode is expressed purely through that one variable:
   *   - 'claude-cli' (default): strip ANTHROPIC_API_KEY → subscription auth (Max)
   *   - 'api-key': set ANTHROPIC_API_KEY (config.apiKey || env) → metered API
   * Throws in 'api-key' mode when no key is available (fail loud, not silent).
   * Pure: does not read/mutate process state beyond the passed baseEnv.
   */
  buildEnv(config = {}, baseEnv = process.env) {
    const mode = config.executorMode || 'claude-cli';
    const env = { ...baseEnv };
    if (mode === 'api-key') {
      const key = config.apiKey || baseEnv.ANTHROPIC_API_KEY;
      if (!key) {
        throw new Error("executorMode 'api-key' requires ANTHROPIC_API_KEY (in config.apiKey or the environment)");
      }
      env.ANTHROPIC_API_KEY = key;
    } else {
      // claude-cli / subscription: never leak a metered key into the child.
      delete env.ANTHROPIC_API_KEY;
    }
    return env;
  }

  /**
   * DF-449 — Detect a rate-limit / usage-cap signal in a spawn result so the
   * runner can stop cleanly instead of looping. Null-safe.
   */
  isRateLimited(result) {
    const text = `${result?.stdout || ''}\n${result?.stderr || ''}`;
    return /rate.?limit|429|usage limit|quota exceeded|overloaded/i.test(text);
  }

  spawn(prompt, config = {}) {
    const args = this.buildArgs(prompt, config);
    const timeout = config.timeout || 30 * 60 * 1000; // 30 minutes
    const cwd = config.workingDir || process.cwd();
    const env = this.buildEnv(config); // may throw for api-key without a key

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const child = spawn('claude', args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

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
