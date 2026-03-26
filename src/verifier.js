import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

export class Verifier {
  constructor(workingDir = process.cwd()) {
    this.workingDir = workingDir;
  }

  async run(verifications) {
    if (!verifications || verifications.length === 0) {
      return { allPassed: true, skipped: true, results: [], failures: [] };
    }

    const results = [];
    const failures = [];

    for (const check of verifications) {
      const result = await this.runCheck(check);
      results.push(result);
      if (!result.passed) {
        failures.push(result);
      }
    }

    return {
      allPassed: failures.length === 0,
      skipped: false,
      results,
      failures,
    };
  }

  async runCheck(check) {
    switch (check.type) {
      case 'command': {
        const { exitCode, output } = this.execCommand(check.command);
        return {
          label: check.label,
          type: check.type,
          passed: exitCode === 0,
          exitCode,
          output,
        };
      }

      case 'file_exists': {
        const exists = this.fileExists(check.path);
        return {
          label: check.label,
          type: check.type,
          passed: exists,
          error: exists ? undefined : `File not found: ${check.path}`,
        };
      }

      case 'file_min_words': {
        try {
          const content = readFileSync(check.path, 'utf-8');
          const words = content.split(/\s+/).filter(w => w.length > 0);
          const wordCount = words.length;
          return {
            label: check.label,
            type: check.type,
            passed: wordCount >= check.min,
            wordCount,
            required: check.min,
          };
        } catch (err) {
          return {
            label: check.label,
            type: check.type,
            passed: false,
            wordCount: 0,
            required: check.min,
            error: err.message,
          };
        }
      }

      case 'file_contains': {
        try {
          const content = readFileSync(check.path, 'utf-8');
          const found = content.includes(check.text);
          return {
            label: check.label,
            type: check.type,
            passed: found,
            error: found ? undefined : `Text not found in ${check.path}`,
          };
        } catch (err) {
          return {
            label: check.label,
            type: check.type,
            passed: false,
            error: err.message,
          };
        }
      }

      case 'field_not_null': {
        return {
          label: check.label,
          type: check.type,
          passed: true,
          note: 'Checked by API',
        };
      }

      default: {
        return {
          label: check.label,
          type: check.type,
          passed: false,
          error: 'Unknown check type',
        };
      }
    }
  }

  execCommand(command) {
    try {
      const output = execSync(command, {
        cwd: this.workingDir,
        encoding: 'utf-8',
        timeout: 5 * 60 * 1000,
        stdio: 'pipe',
      });
      return { exitCode: 0, output };
    } catch (err) {
      const output = (err.stdout || '') + (err.stderr || '');
      return { exitCode: err.status || 1, output };
    }
  }

  fileExists(path) {
    return existsSync(path);
  }
}
