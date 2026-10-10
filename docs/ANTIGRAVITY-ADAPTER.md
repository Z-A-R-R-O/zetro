# Antigravity adapter: first executable slice

**Status:** implemented connection and send slice on Windows, tested against Antigravity 2.21.1 on 2026-10-08. This is a bootstrap adapter, not yet the full Phase 2 dispatcher.

## What works now

- Map AGR-1 through AGR-5 to the five supplied conversation IDs in [`agents.json`](../packages/antigravity-adapter/agents.json).
- Discover a running local Antigravity language server or use the environment injected into an Antigravity-managed sidecar.
- Invoke Antigravity's bundled `agentapi` command to read conversation metadata and send a message.
- Before each send, require the returned root conversation ID, project ID and workspace path to match the configured values.
- Report delivery acknowledgement separately from task verification; never retry a send after an ambiguous failure.

The public `agentapi` command is described in [Antigravity's sidecar documentation](https://antigravity.google/docs/sidecars). The documented commands are `get-conversation-metadata`, `new-conversation`, and `send-message` in the installed CLI help. The documented website currently lists `new-conversation` and `send-message`; `get-conversation-metadata` was confirmed from the installed Antigravity 2.21.1 executable.

## Commands

From the Veyminore root after `pnpm install` and `pnpm --filter @veyminore/zetro-antigravity build`:

```powershell
node products/zetro/packages/antigravity-adapter/dist/cli.js verify
node products/zetro/packages/antigravity-adapter/dist/cli.js inspect AGR-2 --json
node products/zetro/packages/antigravity-adapter/dist/cli.js send AGR-2 "Review the proposed task only."
node products/zetro/packages/antigravity-adapter/dist/cli.js send AGR-2 --file task.txt
node products/zetro/packages/antigravity-adapter/dist/cli.js send AGR-2 "Draft task" --dry-run
```

The shorter workspace command is `pnpm --filter @veyminore/zetro agents verify` (or `agents send AGR-2 ...`).

`verify` exits 0 only when all five identities match. `send` verifies the selected identity first, then submits once. It returns `delivery: submitted` and `verification: not_requested`. A returned acknowledgement does not prove that the worker read, answered or completed the task.

## Live validation on 2026-10-08

| Agent | Metadata ID | Project/workspace | Diagnostic send | Reply observed in UI |
| --- | --- | --- | --- | --- |
| AGR-1 | Match | Match | Acknowledged | `ZETRO_CONNECTED AGR-1` |
| AGR-2 | Match | Match | Acknowledged | Exact token in completed assistant step of local conversation store |
| AGR-3 | Match | Match | Acknowledged | Exact token in completed assistant step of local conversation store |
| AGR-4 | Match | Match | Acknowledged | `ZETRO_CONNECTED AGR-4` |
| AGR-5 | Match | Match | Acknowledged | `ZETRO_CONNECTED AGR-5` |

All five returned project ID `9ab65b57-6580-4788-b50a-28886bc68496` and workspace `E:\Veyminore`. The verification command checked these fields from the live language server, not only from local files. AGR-1, AGR-4 and AGR-5 displayed the exact reply in the app UI. For AGR-2 and AGR-3, a read-only diagnostic check of Antigravity 2.21.1's local conversation store found the exact token in a completed assistant step after submission. That store is an internal implementation detail; the production adapter does not depend on it.

The full [2026-10-08 smoke report](verification/2026-10-08-antigravity-connection.md) records the commands, evidence and limits.

## Discovery and trust

Inside a managed sidecar, the adapter uses `ANTIGRAVITY_LS_ADDRESS` and `ANTIGRAVITY_CSRF_TOKEN` supplied by Antigravity. Outside a sidecar on Windows, it locates the running `language_server.exe`, reads its dynamically assigned loopback listeners and token from the process metadata, and passes them only to the bundled `agentapi` child process. It neither prints nor stores the token. The endpoint is accepted only after a matching metadata response. This Windows fallback depends on Antigravity's local process layout and must be revalidated after an Antigravity upgrade.

## Current limits

- Antigravity's documented `agentapi` surface does not expose conversation message history, streaming progress or cancellation. Therefore `observe()` and `cancel()` are not implemented, and the adapter cannot independently verify a worker result through `agentapi` alone.
- Sends have no public idempotency key. If a process or connection fails after submission, delivery is `unknown`; ZETRO must not resend automatically.
- Automatic process discovery is Windows-only. Running as an Antigravity-managed sidecar can supply environment variables on other platforms, subject to testing.
- The adapter is bound to one Antigravity project and workspace. A changed project or workspace requires an intentional config update and a new live verification.
- This is a CLI and library slice. It has not been mounted into ZETRO's future daemon, MCP interface, worktree dispatcher or evidence store.

## Next implementation gates

1. Add an Antigravity-managed sidecar integration so the documented environment path is the default and Windows process discovery is fallback only.
2. Define a read-back or event adapter through a supported Antigravity surface. If none exists, keep task completion verification external through worktree diffs and tests.
3. Add durable dispatch journal, task IDs, timeouts and a one-worker state machine before assigning real coding work.
