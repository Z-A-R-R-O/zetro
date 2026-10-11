# RCT Real Live Pilot Attempts (2026-10-11)

## Overview

This record documents the first two user-approved live execution attempts of the Real Coding Trial (RCT) single-file pilot against a live model provider. Both attempts failed without modifying source files or proposing patches. No review artifact is ready, and no general live coding reliability is claimed.

Previous milestones:
- [RCT-2 Offline Verification](2026-10-10-rct2-offline.md) (mocked offline execution, scope isolation)
- [RCT-3 Preflight Verification](2026-10-10-rct3-preflight.md) (preflight audit, source pinning)

## Configuration & Scope Boundary

- **Target File**: `docs/README.md` (single-file pilot scope)
- **Pinned Source SHA-256**: `da33cb0dff40cc6276d4acad95c811e136b8d88d9c2dfc9d29ec9ba0777ae234`
- **Manifest**: `docs/tasks/2026-10-10-rct-first-live.json`
- **Approved Manifest Hash**: `e04acbdccd1cecbe56e95433f2b1764a4369c59f7dc8b9f08e30d338697bbfdc`
- **Provider & Model**: Groq `openai/gpt-oss-120b`
- **Credential Handling**: Loaded strictly from local ignored `.env`; never logged, printed, or emitted to receipts.
- **Scope Ceilings**: `readPaths: ["docs/README.md"]`, `writePaths: ["docs/README.md"]`, `createPaths: []`, `maxTurns: 5`, `maxOutputTokens: 2000`.

## Attempt 1 (Initial Live Run)

- **Authorization**: User approved via CLI `--approve <manifestHash>`.
- **Outcome**: `state: failed`
- **Usage**: 1 request, 507 input tokens, 81 output tokens.
- **Patch Status**: No patch proposed or applied (`changedPaths: []`).
- **Source Integrity**: `sourceUnchanged: true`. Disk SHA-256 remained identical to pinned preflight hash.
- **Diagnosis Limitation**: The initial receipt format lacked granular `events` tracking, leaving the exact tool-level failure cause unavailable in the artifact.

## Pre-Retry Diagnostic Verification

Following Attempt 1, diagnostic event capture was implemented in the runtime receipt to record turn-level tool outcomes, and the test suite was verified:
- **Focused Runtime Tests**: `node --test packages/rct-runtime/test/*.test.js` passed with 65 pass, 0 fail, 1 TODO.
- **Authorization**: The user approved exactly one single diagnostic retry.

## Attempt 2 (Diagnostic Retry)

- **Authorization**: Exactly one diagnostic retry authorized by user.
- **Outcome**: `state: failed`
- **Usage**: 1 request, 507 input tokens, 81 output tokens.
- **Remote Accounting**: `remoteUsageUncertain: false`.
- **Patch Status**: No patch proposed or applied.
- **Source Integrity**: `sourceUnchanged: true`. Disk SHA-256 verified identical post-run: `da33cb0dff40cc6276d4acad95c811e136b8d88d9c2dfc9d29ec9ba0777ae234`.
- **Diagnostic Receipt Findings**:
  - `failureReason`: `worker_or_tool_error`
  - Event trace: `turn: 0`, `tool: read_slice`, `ok: false`, `error: Invalid slice`
- **Failure Cause Analysis (Evidence-Limited)**:
  - Proven evidence: The event trace confirms only that `read_slice` failed at turn 0 with `error: Invalid slice`.
  - Unknown factors: The exact model-provided argument shape was not retained in the receipt and remains unknown.
  - Plausible inference: The workspace method already provided default values for omitted `start` and `length`; however, because the tool schema omitted explicit numeric bounds, an out-of-range value (or another invalid argument structure from the model) is plausible, though not proven.

## Current Status & Next Gate

1. **No Further Live Calls Authorized**: The live trial remains strictly stopped; no further live provider calls are authorized.
2. **Offline Contract Repair & Testing**: The schema and bounded input handling were updated. Mocked-provider and mocked-HTTP regressions pass; the repair has not been live-retested.
3. **No Claim of Live Success**: The task did not succeed, no review artifact is ready, and no general live coding reliability is claimed.
4. **Next Gate**:
   - Offline regression tests and repository hygiene passed (`node --test`: 66 pass, 0 fail, 1 TODO; `pnpm -r test`; `pnpm typecheck`; `git diff --check`). The staged diff must also pass `git diff --cached --check` before publication.
   - Any future live attempt requires explicit, fresh user authorization.
