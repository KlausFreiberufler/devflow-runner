import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DevFlowClient } from '../src/client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake Response that fetch would return. */
function fakeResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

/** Install a mock for global.fetch that resolves with the given response. */
function mockFetch(body, status = 200) {
  const fn = vi.fn().mockResolvedValue(fakeResponse(body, status));
  global.fetch = fn;
  return fn;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DevFlowClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ---- Construction -------------------------------------------------------

  describe('constructor', () => {
    it('stores baseUrl and token', () => {
      const client = new DevFlowClient('https://api.example.com', 'tok_123');
      expect(client.baseUrl).toBe('https://api.example.com');
      expect(client.token).toBe('tok_123');
      expect(client.sessionId).toBeNull();
    });

    it('strips trailing slashes from baseUrl', () => {
      const client = new DevFlowClient('https://api.example.com///', 'tok');
      expect(client.baseUrl).toBe('https://api.example.com');
    });

    it('throws if baseUrl is missing', () => {
      expect(() => new DevFlowClient('', 'tok')).toThrow('baseUrl is required');
    });

    it('throws if token is missing', () => {
      expect(() => new DevFlowClient('https://x', '')).toThrow('token is required');
    });
  });

  // ---- getNextStep --------------------------------------------------------

  describe('getNextStep', () => {
    it('returns parsed data from the API', async () => {
      const payload = {
        flowState: 'in_progress',
        pipelineStep: 'implementation',
        phase: 'action',
        actor: 'agent',
        allowedActions: ['flow_update'],
      };
      const fetchMock = mockFetch({ success: true, data: payload });

      const client = new DevFlowClient('https://api.test', 'tok');
      const result = await client.getNextStep('flow-1');

      expect(result).toEqual(payload);
      expect(fetchMock).toHaveBeenCalledOnce();

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.test/api/flows/flow-1/next-step');
      expect(opts.method).toBe('GET');
      expect(opts.headers['Authorization']).toBe('Bearer tok');
    });
  });

  // ---- Error handling -----------------------------------------------------

  describe('error handling', () => {
    it('throws on non-ok HTTP status', async () => {
      mockFetch({ success: false, error: 'Not found' }, 404);

      const client = new DevFlowClient('https://api.test', 'tok');

      await expect(client.getFlow('missing')).rejects.toThrow('Not found');

      try {
        await client.getFlow('missing');
      } catch (err) {
        expect(err.status).toBe(404);
        expect(err.response).toEqual({ success: false, error: 'Not found' });
      }
    });

    it('throws on success:false even with HTTP 200', async () => {
      mockFetch({ success: false, error: 'Validation failed' }, 200);

      const client = new DevFlowClient('https://api.test', 'tok');
      await expect(client.updateFlow('f1', {})).rejects.toThrow('Validation failed');
    });

    it('attaches gate info when present in the response', async () => {
      const body = {
        success: false,
        error: 'Gate blocked',
        gate: { blocked: true, blockedFor: 'agent' },
      };
      mockFetch(body, 403);

      const client = new DevFlowClient('https://api.test', 'tok');

      try {
        await client.updateFlow('f1', { currentState: 'done' });
      } catch (err) {
        expect(err.status).toBe(403);
        expect(err.gate).toEqual({ blocked: true, blockedFor: 'agent' });
      }
    });
  });

  // ---- X-Agent-Session header after initSession ---------------------------

  describe('X-Agent-Session header', () => {
    it('is NOT sent before initSession', async () => {
      const fetchMock = mockFetch({ success: true, data: {} });

      const client = new DevFlowClient('https://api.test', 'tok');
      await client.getFlow('f1');

      const headers = fetchMock.mock.calls[0][1].headers;
      expect(headers).not.toHaveProperty('X-Agent-Session');
    });

    it('is included after initSession sets sessionId', async () => {
      const fetchMock = mockFetch({ success: true, data: { sessionId: 'sess-42' } });

      const client = new DevFlowClient('https://api.test', 'tok');
      await client.initSession('flow-1');

      expect(client.sessionId).toBe('sess-42');

      // Reset the mock for the next call
      fetchMock.mockResolvedValue(fakeResponse({ success: true, data: { id: 'flow-1' } }));
      await client.getFlow('flow-1');

      const headers = fetchMock.mock.calls[1][1].headers;
      expect(headers['X-Agent-Session']).toBe('sess-42');
    });
  });

  // ---- Session lifecycle methods ------------------------------------------

  describe('session lifecycle', () => {
    it('logSession throws if no session is active', async () => {
      const client = new DevFlowClient('https://api.test', 'tok');
      await expect(client.logSession('hello')).rejects.toThrow('No active session');
    });

    it('completeSession throws if no session is active', async () => {
      const client = new DevFlowClient('https://api.test', 'tok');
      await expect(client.completeSession()).rejects.toThrow('No active session');
    });

    it('touchActivity throws if no session is active', async () => {
      const client = new DevFlowClient('https://api.test', 'tok');
      await expect(client.touchActivity()).rejects.toThrow('No active session');
    });

    it('logSession sends correct payload', async () => {
      const fetchMock = mockFetch({ success: true, data: { sessionId: 's1' } });
      const client = new DevFlowClient('https://api.test', 'tok');
      await client.initSession('f1');

      fetchMock.mockResolvedValue(fakeResponse({ success: true, data: {} }));
      await client.logSession('did a thing', 'warn', 'build');

      const [url, opts] = fetchMock.mock.calls[1];
      expect(url).toBe('https://api.test/api/agent-sessions/s1/log');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body).toEqual({ message: 'did a thing', level: 'warn', category: 'build' });
    });
  });

  // ---- listFlows with query params ----------------------------------------

  describe('listFlows', () => {
    it('appends query parameters to the URL', async () => {
      const fetchMock = mockFetch({ success: true, data: [] });

      const client = new DevFlowClient('https://api.test', 'tok');
      await client.listFlows({ state: 'in_progress', projectId: 'p1' });

      const url = fetchMock.mock.calls[0][0];
      expect(url).toContain('/api/flows?');
      expect(url).toContain('state=in_progress');
      expect(url).toContain('projectId=p1');
    });

    it('works without params', async () => {
      const fetchMock = mockFetch({ success: true, data: [] });

      const client = new DevFlowClient('https://api.test', 'tok');
      await client.listFlows();

      const url = fetchMock.mock.calls[0][0];
      expect(url).toBe('https://api.test/api/flows');
    });
  });

  // ---- submitReview -------------------------------------------------------

  describe('submitReview', () => {
    it('sends stepKey, result, and optional feedback', async () => {
      const fetchMock = mockFetch({ success: true, data: {} });

      const client = new DevFlowClient('https://api.test', 'tok');
      await client.submitReview('f1', 'code_review', 'approved', 'Looks good');

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.test/api/flows/f1/reviews');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body).toEqual({
        stepKey: 'code_review',
        result: 'approved',
        feedback: 'Looks good',
      });
    });
  });

  // ---- Retry on transient errors -------------------------------------------

  describe('Retry logic', () => {
    it('should retry on 500 errors up to 3 times', async () => {
      let callCount = 0
      global.fetch = vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount <= 3) {
          return fakeResponse({ success: false, error: 'Internal Server Error' }, 500)
        }
        return fakeResponse({ success: true, data: { flowState: 'done' } })
      })

      const client = new DevFlowClient('https://api.test', 'tok')
      const result = await client.getNextStep('f1')

      expect(result.flowState).toBe('done')
      expect(callCount).toBe(4) // 3 retries + 1 success
    })

    it('should retry on network errors (fetch throws)', async () => {
      let callCount = 0
      global.fetch = vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount <= 2) {
          throw new Error('ECONNREFUSED')
        }
        return fakeResponse({ success: true, data: {} })
      })

      const client = new DevFlowClient('https://api.test', 'tok')
      const result = await client.getNextStep('f1')

      expect(callCount).toBe(3)
    })

    it('should NOT retry on 401/403 errors', async () => {
      let callCount = 0
      global.fetch = vi.fn().mockImplementation(async () => {
        callCount++
        return fakeResponse({ success: false, error: 'Unauthorized' }, 401)
      })

      const client = new DevFlowClient('https://api.test', 'tok')
      await expect(client.getNextStep('f1')).rejects.toThrow('Unauthorized')
      expect(callCount).toBe(1) // No retry
    })

    it('should throw after max retries exhausted', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        fakeResponse({ success: false, error: 'Server Error' }, 500)
      )

      const client = new DevFlowClient('https://api.test', 'tok')
      await expect(client.getNextStep('f1')).rejects.toThrow('Server Error')
    })
  });
});
