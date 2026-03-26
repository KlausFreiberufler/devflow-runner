import { describe, it, expect } from 'vitest';
import { ClaudeAdapter } from '../../src/adapters/claude.js';

describe('ClaudeAdapter', () => {
  describe('buildArgs', () => {
    it('produces correct array with model and prompt', () => {
      const adapter = new ClaudeAdapter();
      const args = adapter.buildArgs('Do something', { model: 'opus' });

      expect(args).toEqual([
        '--model', 'opus',
        '-p', 'Do something',
      ]);
    });

    it('uses sonnet as default model', () => {
      const adapter = new ClaudeAdapter();
      const args = adapter.buildArgs('Hello', {});

      expect(args).toEqual([
        '--model', 'sonnet',
        '-p', 'Hello',
      ]);
    });

    it('includes --mcp-config when provided', () => {
      const adapter = new ClaudeAdapter();
      const args = adapter.buildArgs('Do something', {
        model: 'sonnet',
        mcpConfig: '/path/to/mcp.json',
      });

      expect(args).toEqual([
        '--model', 'sonnet',
        '-p', 'Do something',
        '--mcp-config', '/path/to/mcp.json',
      ]);
    });

    it('omits --mcp-config when not provided', () => {
      const adapter = new ClaudeAdapter();
      const args = adapter.buildArgs('Do something', { model: 'sonnet' });

      expect(args).toEqual([
        '--model', 'sonnet',
        '-p', 'Do something',
      ]);
      expect(args).not.toContain('--mcp-config');
    });
  });
});
