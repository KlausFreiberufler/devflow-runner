# DevFlow Runner

Cross-platform CLI that executes [DevFlow](https://app.dev-flow.tech) flows autonomously: it picks up flows from the runner queue, spawns Claude Code per pipeline step, verifies the results, and advances the flow — up to human gates.

## Platform boundaries

| Platform | Recommended way to run flows |
|---|---|
| **macOS** | Use the **DevFlow Factory app** — the runner engine (loop, Claude adapter, verifier, fan-out) and the watch mode are built in, with a native radar UI, live logs, and a start/stop toggle. No CLI process needed. |
| **Windows / Linux / headless (CI, servers)** | Use **this CLI** — same engine semantics, no UI. |

Both executors share the same backend contract: the runner queue (`GET /api/flows/runner-queue`, `POST /api/flows/:id/runner-complete`), agent-session leases, and the pipeline next-step API. Running both against the same flow is safe — the lease makes a second executor back off with `409 flow_locked`.

## Commands

```bash
devflow-runner setup            # one-time: API URL + token + project paths
devflow-runner run [flow-id]    # run one flow (default command)
devflow-runner run --all        # run every flow waiting in the queue
devflow-runner run --until-gate # stop at the next human gate
devflow-runner watch            # keep running: Socket.IO push + polling fallback
```

## How it executes a flow

1. `POST /api/agent-sessions/init` — acquires the flow lease.
2. Loop over `GET /api/flows/:id/next-step`: auto-transitions and gates are handled directly; work steps spawn `claude` with a scoped prompt and a temp MCP config.
3. On the implementation step, a per-task fan-out plan (if any) runs one scoped worker per open task — sequentially, stopping early on failure.
4. Skill verifications run after each step; failures trigger a repair loop (max 3), then escalate as a rejected review.
5. Uses your Claude subscription: `ANTHROPIC_API_KEY` is stripped from the child environment.

## Configuration

`~/.devflow/runner.json` holds the API URL and per-project repo paths; credentials are stored separately by `setup`. `DEVFLOW_TOKEN` overrides the stored token (useful for CI).
