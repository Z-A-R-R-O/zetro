# AGR-1 Live Bridge Diagnostic — 2026-10-08

## 1. fetch_task Latency Attribution

**Observed:** ~5m52s wall time for `fetch_task` MCP call (created 12:00:26Z, completed 12:06:18Z).  
**Expected:** Local MCP roundtrip <2s (server tests confirm ~11ms server-side, ~1.5s full roundtrip).

### Root Cause: Unknown

The cause of the ~5m52s latency **cannot be definitively attributed** from available evidence.

**Timeline from transcript:**
- **Step 140 (12:00:10Z):** DNS error for `daily-cloudcode-pa.googleapis.com` — occurs **before** the fetch_task call was initiated.
- **Steps 145–147 (12:06:46–12:07:08Z):** Three consecutive DNS errors — occur **after** fetch_task had already completed at 12:06:18Z.

**Conclusion:** The DNS errors at steps 145–147 cannot explain the fetch latency because they occurred after completion. Step 140 preceded the call but its causal link is unproven. Possible explanations include host-side permission waiting, MCP transport queueing, or network conditions, but **no server-side timestamps existed** during this call to isolate ZETRO-local vs host latency.

### Instrumentation Added

Entry/exit `performance.now()` timestamps added to the MCP server's `CallToolRequestSchema` handler in `server.js`. When `ZETRO_MCP_DIAG_LOG` is set, each tool call logs:

```json
{"tool":"fetch_task","entryIso":"...","exitIso":"...","durationMs":11.23,"status":"ok"}
```

This will allow future probes to compare server-side execution time against observed wall time, isolating ZETRO-local latency from external/host latency.

### Benchmark Baseline (from existing tests)
- Server-side `fetch_task`: ~11ms (from `server.test.js`)
- Full coordinator roundtrip (seed + fetch + submit + inspect): ~1.18s (from `roundtrip.test.js`)

## 2. hook/stop.js eventId Collision Fix

**Bug:** `eventId` was `stop-${conversationId}-${executionNum}`. When `executionNum=0` repeats across multiple real Stop events (observed 3 times), IDs collide.

**Fix:** Replaced with `stop-${crypto.randomUUID()}` using Node built-in `node:crypto`. Each event now receives a globally unique, immutable UUID.

**Test Evidence:** 3 consecutive events with `executionNum=0` produce 3 distinct UUIDs validated by regex. All 6 hook fixture tests pass.

## Files Changed
- `packages/antigravity-bridge/hook/stop.js` — `crypto.randomUUID()` eventId
- `packages/antigravity-bridge/hook/stop.test.js` — uniqueness + UUID format test
- `packages/antigravity-bridge/mcp/src/server.js` — entry/exit `performance.now()` instrumentation

## Test Results
```
Hook tests:    6/6 pass (including eventId uniqueness)
Server tests:  5/5 pass (instrumentation preserved all behavior)
Roundtrip:     3/3 pass (end-to-end seed/fetch/submit/inspect)
```
