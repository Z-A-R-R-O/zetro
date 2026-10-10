# @zetro/antigravity-bridge-mcp

Narrow worker-return channel core for integrating Antigravity capabilities with Zetro via MCP (Model Context Protocol).
Provides a bounded, demand-driven channel for retrieving tasks and submitting claims/receipts.

## MCP Server

This package implements an official stdio MCP Server using `@modelcontextprotocol/sdk`.

**Tools Exposed:**
- `fetch_task`: Retrieves securely scoped task registry fields or specifically requested context sectionRefs. Treats `capabilityDigest` as an unguessable per-task bearer capability.
- `submit_receipt`: Idempotently submits typed worker receipts (claims) back to the coordinator. Rejects replays and strictly prevents `../` path traversal outside `allowedPaths`.

**Important Guarantees Provided:**
1. **Scope limits**: Tasks are strictly partitioned by hashed `taskId` and `capabilityDigest`.
2. **Secrets rejection**: Any payload with `secrets`/`password`/`token`/`apiKey` keys will be aggressively rejected during `_seedTask` and `submit_receipt`.
3. **Hard Budgets**: Throws if context output or receipt input payloads exceed `MCP_MAX_BUDGET` characters.
4. **Idempotency & Concurrency**: Submitting an identical receipt returns an idempotent success ack, while conflicting replays are actively rejected. Uses `wx` atomic writes to prevent concurrent overwrites.

## Coordinator CLI

Provides a safe way to seed new bounded task records and securely inspect receipts.

**Seed Task:**
```bash
node src/coordinator.js seed --agent "agent-name" --objective "Do X" --acceptanceCriteria "X Done" --allowedPaths "/safe/path"
```
Prints a compact `dispatch` handoff containing the CSPRNG `taskId` and `capabilityDigest` (bearer token).

**Inspect Receipt:**
```bash
node src/coordinator.js inspect --taskId "..." --capabilityDigest "..."
```

**LIMITATIONS & DISCLAIMER:**
- Secrets filtering is based on substring matching of keys (`secret`, `token`, `password`, `apikey`). Extremely novel keys might not be scrubbed.
- The capability verification relies on the `capabilityDigest`. We do not guarantee strong cryptographic proof of worker execution at this layer.
- Atomic guarantees use exclusive file creation (`wx`), which is robust locally but may lack strong guarantees across certain network-mounted filesystems.
