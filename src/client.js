/**
 * DevFlow API Client
 *
 * Wraps the DevFlow backend REST API for use by the autonomous runner.
 * Handles authentication, session tracking, and structured error handling.
 */

export class DevFlowClient {
  /**
   * @param {string} baseUrl  — Backend base URL, e.g. "https://api.flow.dev"
   * @param {string} token    — JWT bearer token for authentication
   */
  constructor(baseUrl, token) {
    if (!baseUrl) throw new Error('baseUrl is required');
    if (!token) throw new Error('token is required');
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
    this.sessionId = null;
  }

  // ---------------------------------------------------------------------------
  // Core HTTP
  // ---------------------------------------------------------------------------

  /**
   * Send an authenticated request to the DevFlow API.
   *
   * @param {'GET'|'POST'|'PATCH'|'PUT'|'DELETE'} method
   * @param {string} path  — e.g. "/api/flows/123"
   * @param {object} [body]
   * @returns {Promise<object>} — parsed response body
   * @throws {Error} with `status`, `response`, and optional `gate` properties
   */
  async request(method, path, body) {
    const url = `${this.baseUrl}${path}`;

    const headers = {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };

    if (this.sessionId) {
      headers['X-Agent-Session'] = this.sessionId;
    }

    const options = { method, headers };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const res = await fetch(url, options);
    const json = await res.json();

    if (!res.ok || json.success === false) {
      const err = new Error(json.error || `API ${method} ${path} failed (${res.status})`);
      err.status = res.status;
      err.response = json;
      if (json.gate) {
        err.gate = json.gate;
      }
      throw err;
    }

    return json.data !== undefined ? json.data : json;
  }

  // ---------------------------------------------------------------------------
  // Agent session lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Initialise an agent session for the given flow.
   * Stores the returned sessionId for subsequent requests.
   *
   * @param {string} flowId
   * @returns {Promise<object>} — full init response data
   */
  async initSession(flowId) {
    const data = await this.request('POST', '/api/agent-sessions/init', { flowId });
    // Backend returns session.id, not sessionId
    this.sessionId = data.sessionId || data.session?.id || null;
    return data;
  }

  /**
   * Append a log entry to the current agent session.
   *
   * @param {string} message
   * @param {'info'|'warn'|'error'|'debug'} [level='info']
   * @param {string} [category]
   * @returns {Promise<object>}
   */
  async logSession(message, level = 'info', category) {
    if (!this.sessionId) throw new Error('No active session — call initSession() first');
    return this.request('POST', `/api/agent-sessions/${this.sessionId}/log`, {
      message,
      level,
      ...(category ? { category } : {}),
    });
  }

  /**
   * Mark the current agent session as completed.
   *
   * @param {string} [message]
   * @returns {Promise<object>}
   */
  async completeSession(message) {
    if (!this.sessionId) throw new Error('No active session — call initSession() first');
    return this.request('POST', `/api/agent-sessions/${this.sessionId}/complete`, {
      ...(message ? { message } : {}),
    });
  }

  /**
   * Heartbeat — touch the activity timestamp of the current session.
   *
   * @returns {Promise<object>}
   */
  async touchActivity() {
    if (!this.sessionId) throw new Error('No active session — call initSession() first');
    return this.request('PATCH', `/api/agent-sessions/${this.sessionId}/activity`);
  }

  // ---------------------------------------------------------------------------
  // Flow operations
  // ---------------------------------------------------------------------------

  /**
   * Resolve a display ID (e.g. "DF-42") to the actual flow ID.
   * If the input is already a UUID-style ID, returns it unchanged.
   *
   * @param {string} flowIdOrDisplayId
   * @returns {Promise<string>} — actual flow ID
   */
  async resolveFlowId(flowIdOrDisplayId) {
    if (!flowIdOrDisplayId.match(/^[A-Z]+-\d+$/i)) return flowIdOrDisplayId;
    const flows = await this.listFlows();
    const found = (Array.isArray(flows) ? flows : []).find(
      f => f.displayId === flowIdOrDisplayId || f.display_id === flowIdOrDisplayId
    );
    if (!found) throw new Error(`Flow ${flowIdOrDisplayId} not found`);
    return found.id;
  }

  /**
   * Fetch a single flow by ID.
   *
   * @param {string} flowId
   * @returns {Promise<object>}
   */
  async getFlow(flowId) {
    return this.request('GET', `/api/flows/${flowId}`);
  }

  /**
   * Get the pipeline next-step descriptor for a flow.
   *
   * @param {string} flowId
   * @returns {Promise<object>}
   */
  async getNextStep(flowId) {
    return this.request('GET', `/api/flows/${flowId}/next-step`);
  }

  /**
   * Partially update a flow (state transition, plan, summary, etc.).
   *
   * @param {string} flowId
   * @param {object} updates
   * @returns {Promise<object>}
   */
  async updateFlow(flowId, updates) {
    return this.request('PATCH', `/api/flows/${flowId}`, updates);
  }

  /**
   * Submit a review for a specific pipeline step.
   *
   * @param {string} flowId
   * @param {string} stepKey   — e.g. "code_review", "testing"
   * @param {'approved'|'rejected'} result
   * @param {string} [feedback]
   * @returns {Promise<object>}
   */
  async submitReview(flowId, stepKey, result, feedback) {
    return this.request('POST', `/api/flows/${flowId}/reviews`, {
      stepKey,
      result,
      ...(feedback ? { feedback } : {}),
    });
  }

  /**
   * List projects accessible by the authenticated user.
   *
   * @returns {Promise<Array>}
   */
  async listProjects() {
    return this.request('GET', '/api/projects');
  }

  /**
   * List flows, optionally filtered by query parameters.
   *
   * @param {object} [params] — key/value pairs appended as query string
   * @returns {Promise<object>}
   */
  async listFlows(params) {
    let path = '/api/flows';
    if (params && Object.keys(params).length > 0) {
      const qs = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          qs.append(key, String(value));
        }
      }
      const qsStr = qs.toString();
      if (qsStr) {
        path += `?${qsStr}`;
      }
    }
    return this.request('GET', path);
  }

  // ---------------------------------------------------------------------------
  // Runner queue
  // ---------------------------------------------------------------------------

  /**
   * Get flows that have been requested for runner execution.
   * Returns flows with runner_requested=1 in ready/in_progress state.
   *
   * @param {string} [projectId] — optional filter by project
   * @returns {Promise<Array>}
   */
  async getRunnerQueue(projectId) {
    const qs = projectId ? `?projectId=${projectId}` : '';
    return this.request('GET', `/api/flows/runner-queue${qs}`);
  }

  /**
   * Mark a flow as runner-complete (reset runner_requested to 0).
   *
   * @param {string} flowId
   * @returns {Promise<object>}
   */
  async completeRunnerRequest(flowId) {
    return this.request('POST', `/api/flows/${flowId}/runner-complete`);
  }
}
