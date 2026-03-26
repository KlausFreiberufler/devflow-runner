import { describe, it, expect } from 'vitest';
import { Verifier } from '../src/verifier.js';

function createVerifier(overrides = {}) {
  const verifier = new Verifier('/tmp/test-workdir');
  if (overrides.execCommand) {
    verifier.execCommand = overrides.execCommand;
  }
  if (overrides.fileExists) {
    verifier.fileExists = overrides.fileExists;
  }
  return verifier;
}

describe('Verifier', () => {
  describe('command check', () => {
    it('passes on exit code 0', async () => {
      const verifier = createVerifier({
        execCommand: () => ({ exitCode: 0, output: 'all good' }),
      });

      const result = await verifier.runCheck({
        type: 'command',
        label: 'Run tests',
        command: 'npm test',
      });

      expect(result).toEqual({
        label: 'Run tests',
        type: 'command',
        passed: true,
        exitCode: 0,
        output: 'all good',
      });
    });

    it('fails on non-zero exit code', async () => {
      const verifier = createVerifier({
        execCommand: () => ({ exitCode: 1, output: 'FAIL' }),
      });

      const result = await verifier.runCheck({
        type: 'command',
        label: 'Run tests',
        command: 'npm test',
      });

      expect(result).toEqual({
        label: 'Run tests',
        type: 'command',
        passed: false,
        exitCode: 1,
        output: 'FAIL',
      });
    });
  });

  describe('file_exists check', () => {
    it('passes when file exists', async () => {
      const verifier = createVerifier({
        fileExists: () => true,
      });

      const result = await verifier.runCheck({
        type: 'file_exists',
        label: 'README exists',
        path: '/tmp/README.md',
      });

      expect(result.passed).toBe(true);
      expect(result.type).toBe('file_exists');
      expect(result.error).toBeUndefined();
    });

    it('fails when file is missing', async () => {
      const verifier = createVerifier({
        fileExists: () => false,
      });

      const result = await verifier.runCheck({
        type: 'file_exists',
        label: 'README exists',
        path: '/tmp/README.md',
      });

      expect(result.passed).toBe(false);
      expect(result.error).toBe('File not found: /tmp/README.md');
    });
  });

  describe('empty verifications', () => {
    it('returns allPassed and skipped for empty array', async () => {
      const verifier = createVerifier();

      const result = await verifier.run([]);

      expect(result).toEqual({
        allPassed: true,
        skipped: true,
        results: [],
        failures: [],
      });
    });

    it('returns allPassed and skipped for null', async () => {
      const verifier = createVerifier();

      const result = await verifier.run(null);

      expect(result).toEqual({
        allPassed: true,
        skipped: true,
        results: [],
        failures: [],
      });
    });
  });

  describe('file_min_words check', () => {
    it('passes when file has enough words', async () => {
      const verifier = new Verifier('/tmp');
      // Mock readFileSync by testing with a real temporary approach —
      // instead we test via the run method with a real file
      // For unit isolation, we test the logic directly:
      const { readFileSync, writeFileSync, unlinkSync } = await import('node:fs');
      const path = '/tmp/test-min-words.txt';
      writeFileSync(path, 'one two three four five six seven eight nine ten');

      const result = await verifier.runCheck({
        type: 'file_min_words',
        label: 'Docs has enough words',
        path,
        min: 5,
      });

      unlinkSync(path);

      expect(result.passed).toBe(true);
      expect(result.wordCount).toBe(10);
      expect(result.required).toBe(5);
    });

    it('fails when file has too few words', async () => {
      const { writeFileSync, unlinkSync } = await import('node:fs');
      const verifier = new Verifier('/tmp');
      const path = '/tmp/test-min-words-fail.txt';
      writeFileSync(path, 'only three words');

      const result = await verifier.runCheck({
        type: 'file_min_words',
        label: 'Docs has enough words',
        path,
        min: 10,
      });

      unlinkSync(path);

      expect(result.passed).toBe(false);
      expect(result.wordCount).toBe(3);
      expect(result.required).toBe(10);
    });
  });

  describe('file_contains check', () => {
    it('passes when text is found', async () => {
      const { writeFileSync, unlinkSync } = await import('node:fs');
      const verifier = new Verifier('/tmp');
      const path = '/tmp/test-contains.txt';
      writeFileSync(path, 'Hello World, this is a test file.');

      const result = await verifier.runCheck({
        type: 'file_contains',
        label: 'File contains greeting',
        path,
        text: 'Hello World',
      });

      unlinkSync(path);

      expect(result.passed).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('fails when text is not found', async () => {
      const { writeFileSync, unlinkSync } = await import('node:fs');
      const verifier = new Verifier('/tmp');
      const path = '/tmp/test-contains-fail.txt';
      writeFileSync(path, 'Nothing relevant here.');

      const result = await verifier.runCheck({
        type: 'file_contains',
        label: 'File contains greeting',
        path,
        text: 'Hello World',
      });

      unlinkSync(path);

      expect(result.passed).toBe(false);
      expect(result.error).toContain('Text not found');
    });
  });

  describe('unknown check type', () => {
    it('fails with error message', async () => {
      const verifier = createVerifier();

      const result = await verifier.runCheck({
        type: 'magic_check',
        label: 'Unknown',
      });

      expect(result.passed).toBe(false);
      expect(result.error).toBe('Unknown check type');
    });
  });

  describe('field_not_null check', () => {
    it('always passes with API note', async () => {
      const verifier = createVerifier();

      const result = await verifier.runCheck({
        type: 'field_not_null',
        label: 'PR URL set',
      });

      expect(result.passed).toBe(true);
      expect(result.note).toBe('Checked by API');
    });
  });

  describe('run() aggregation', () => {
    it('reports allPassed when all checks pass', async () => {
      const verifier = createVerifier({
        execCommand: () => ({ exitCode: 0, output: 'ok' }),
        fileExists: () => true,
      });

      const result = await verifier.run([
        { type: 'command', label: 'Test', command: 'echo hi' },
        { type: 'file_exists', label: 'File', path: '/tmp/x' },
      ]);

      expect(result.allPassed).toBe(true);
      expect(result.skipped).toBe(false);
      expect(result.results).toHaveLength(2);
      expect(result.failures).toHaveLength(0);
    });

    it('reports failures correctly', async () => {
      const verifier = createVerifier({
        execCommand: () => ({ exitCode: 1, output: 'fail' }),
        fileExists: () => true,
      });

      const result = await verifier.run([
        { type: 'command', label: 'Failing test', command: 'exit 1' },
        { type: 'file_exists', label: 'File', path: '/tmp/x' },
      ]);

      expect(result.allPassed).toBe(false);
      expect(result.results).toHaveLength(2);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].label).toBe('Failing test');
    });
  });
});
