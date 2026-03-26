export class Logger {
  constructor(client = null) {
    this.client = client;
  }

  async info(message, category = null) {
    console.log(`${new Date().toLocaleTimeString()} ℹ️  ${message}`);
    try {
      await this.client?.logSession(message, 'info', category);
    } catch (_) {
      // Logging errors must never break the runner
    }
  }

  async warn(message, category = null) {
    console.log(`${new Date().toLocaleTimeString()} ⚠️  ${message}`);
    try {
      await this.client?.logSession(message, 'warn', category);
    } catch (_) {
      // Logging errors must never break the runner
    }
  }

  async error(message, category = null) {
    console.error(`${new Date().toLocaleTimeString()} ❌ ${message}`);
    try {
      await this.client?.logSession(message, 'error', category);
    } catch (_) {
      // Logging errors must never break the runner
    }
  }

  async step(emoji, message) {
    console.log(`${new Date().toLocaleTimeString()} ${emoji} ${message}`);
    try {
      await this.client?.logSession(message, 'info', 'runner');
    } catch (_) {
      // Logging errors must never break the runner
    }
  }
}
