# Legacy Candidate Audit & Baseline Plan

**Date:** 2026-10-08

## 1. Candidate Inventory (`E:\Workspace\Veyminore-CLI\ZRO`)
* **Relationship Unproven:** Do not definitively label this path as Veyrezio. The code and docs do not reference Veyrezio or AGR, leaving provenance unknown.
* **Potential Reuse:** The directory contains components for `contracts`, `storage` (via `better-sqlite3`), and `tests` (desktop/Playwright). Because the ZETRO masterplan explicitly contemplates future SQLite and computer runtimes, these are valid targets.
* **Decision:** **Inspect before reuse**. Treat as a candidate inventory with unknown provenance but potentially reusable elements.

## 2. Claimed Feature Comparison
The masterplan attachment claimed specific features from a previous Veyrezio audit. Their verification status is:
* **Loopback server:** Source unavailable.
* **MCP/API access:** Source unavailable.
* **Antigravity sidecar:** Source unavailable.
* **Desktop bridge:** Source unavailable.
* **SQLite state:** Source unavailable (candidate directory contains `better-sqlite3` but no verified link).
* **Finite dispatch:** Source unavailable.
* **Audit, Worktrees, AGR/ORW division:** Source unavailable.

## 3. Command Baselines
Distinguishing isolated mock/unit suite timings from live integrated CLI execution ranges.

* **`verify-all`** (`node products/zetro/apps/agent-tools/src/cli.js verify-all`)
  * Mock/Unit: < 10ms range.
  * Live CLI Sample: ~1395ms.
  * Output: ~850 characters.

* **`status-compact`** (`node products/zetro/apps/agent-tools/src/cli.js status-compact`)
  * Mock/Unit: < 10ms range.
  * Live CLI Sample: ~1000ms - 2000ms.
  * Output: ~340 characters.

* **`context pack`** (`node products/zetro/packages/context-budget/src/cli.js pack ...`)
  * Mock/Unit E2E: ~354ms sample.
  * Enforcement Logic: ~152ms - 763ms range.
  * Output: JSON containing `metrics.savedChars`.

## 4. Measurable Benchmark Fixture Plan
Based strictly on `apps/agent-tools/test/test.js` mock boundaries:
* **Fixture A (verify-all):** 5 agents, simulating 500-character payload errors per agent.
* **Fixture B (status-compact):** 5 agents, stripping `workspace` and `conversationId`.
* **Fixture C (context pack):** `5000` character payload budgets compressing to `< 2000` chars. Validate exact execution ms and character length enforcement.
