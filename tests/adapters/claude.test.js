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

  // DF-449 — executor-mode auth + rate-limit detection + new model IDs
  describe('resolveModel (DF-449 additions)', () => {
    const adapter = new ClaudeAdapter();
    it('maps current opus/sonnet IDs to CLI short names', () => {
      expect(adapter.resolveModel('claude-opus-4-8')).toBe('opus');
      expect(adapter.resolveModel('claude-opus-4-7')).toBe('opus');
      expect(adapter.resolveModel('claude-sonnet-5')).toBe('sonnet');
    });
    it('keeps existing mappings + passthrough for unknown', () => {
      expect(adapter.resolveModel('claude-opus-4-6')).toBe('opus');
      expect(adapter.resolveModel()).toBe('sonnet');
      expect(adapter.resolveModel('opus')).toBe('opus');
    });
  });

  describe('buildEnv (DF-449)', () => {
    const adapter = new ClaudeAdapter();
    it('claude-cli mode (default) strips ANTHROPIC_API_KEY -> subscription/Max auth', () => {
      const env = adapter.buildEnv({ executorMode: 'claude-cli' }, { PATH: '/x', ANTHROPIC_API_KEY: 'sk-metered' });
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.PATH).toBe('/x');
    });
    it('defaults to claude-cli when no mode is given', () => {
      const env = adapter.buildEnv({}, { ANTHROPIC_API_KEY: 'sk-x' });
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    });
    it('api-key mode sets ANTHROPIC_API_KEY from config', () => {
      const env = adapter.buildEnv({ executorMode: 'api-key', apiKey: 'sk-from-config' }, { PATH: '/x' });
      expect(env.ANTHROPIC_API_KEY).toBe('sk-from-config');
    });
    it('api-key mode falls back to the ambient key', () => {
      const env = adapter.buildEnv({ executorMode: 'api-key' }, { ANTHROPIC_API_KEY: 'sk-ambient' });
      expect(env.ANTHROPIC_API_KEY).toBe('sk-ambient');
    });
    it('api-key mode with no key throws (fail loud, not silent)', () => {
      expect(() => adapter.buildEnv({ executorMode: 'api-key' }, { PATH: '/x' })).toThrow(/ANTHROPIC_API_KEY/);
    });
  });

  describe('isRateLimited (DF-449)', () => {
    const adapter = new ClaudeAdapter();
    it('detects rate-limit / usage-cap signals in output', () => {
      expect(adapter.isRateLimited({ stdout: 'hit rate limit', stderr: '' })).toBe(true);
      expect(adapter.isRateLimited({ stdout: '', stderr: 'HTTP 429 Too Many Requests' })).toBe(true);
      expect(adapter.isRateLimited({ stderr: 'usage limit reached' })).toBe(true);
    });
    it('is false for clean output and null-safe', () => {
      expect(adapter.isRateLimited({ stdout: 'all good', stderr: '' })).toBe(false);
      expect(adapter.isRateLimited(null)).toBe(false);
      expect(adapter.isRateLimited(undefined)).toBe(false);
    });
  });
});
