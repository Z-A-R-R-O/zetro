# Bridge Acceptance & Rollback Plan

**Target:** AGR-1 One-chat End-to-End Execution

## 1. Acceptance Criteria

* **Task ID Creation:** A unique Task ID must be generated and durably journaled prior to dispatch.
* **Minimal Context & Capability:** Task payloads must pass strict `context-budget` limits, allocating only the minimally necessary capabilities for the bounded execution.
* **Adapter Verified Send:** The dispatch must execute cleanly through the adapter port as a one-shot payload.
* **Stop Hook Event Meaning:** The `Stop` hook indicates **execution-loop termination**. It is not a definitive task/session termination and does not mandate a `CANCELLED` state. If `fullyIdle` is `false`, it indicates background work is ongoing.
* **Worker MCP Receipt:** This receipt is a **worker self-report**, not an adapter receipt. It must declare permitted terminal or awaiting states matching the expected ID.
* **Independent Checks:** Successful verification requires explicit independent test passing, not solely agent self-attestation.
* **Unknown/Failed States:** Network boundaries, hard timeouts, or ambiguous crash states default rigorously to `UNKNOWN` or `FAILED`.
* **No Duplicate Resend:** A task resolving to `UNKNOWN` post-submission is never automatically retried.

## 2. Benchmark Method (Latency & Output Size)

**Method:** 
Evaluate performance using standard CLI dry-runs (`node products/zetro/apps/agent-tools/src/cli.js send-packed ... --dry-run`) and capture execution time alongside raw character counts. Token costs are out-of-scope; use precise character yields.

**Baseline vs Target:**
* **Baseline:** Current CLI `verify-all` averages ~1395ms overhead producing ~850 characters. `context pack` budgets require ~150–760ms for compression targets.
* **Target:** To be established post-measurement. The objective is to record latency variance and character compression ratios cleanly against the existing verified baselines.

## 3. Rollback Plan
Should acceptance fail, immediately **remove and disable the exact hook, MCP, and sidecar configurations** bridging the live system. The durable orchestration journal must be explicitly preserved to retain the diagnostic audit trail.
