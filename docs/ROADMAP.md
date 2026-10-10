# ZETRO delivery roadmap

**Ordering, not calendar promises.** The user prioritized an Antigravity adapter as the first executable slice. [ADR-002](decisions/ADR-002-adapter-first.md) records this change. The adapter connection slice can precede the computer runtime; a full dispatcher still depends on policy, durable state and evidence gates.

**Current execution focus (2026-10-08):** Antigravity is paused by operator request. RCT's one-worker synthetic pilot is active; its detailed increments and exit tests are in the [RCT implementation masterplan](RCT-PLAN.md#15-delivery-increments-and-exit-tests). The phases below remain the broader ZETRO roadmap, not a claim that Antigravity dispatch or the computer runtime is currently active.

## First build — Antigravity connection slice (connection complete, dispatch paused)

Implement fixed AGR conversation mapping, live metadata verification, one-shot message submission and a CLI. Exit when all five IDs match the expected Antigravity project and workspace, sends are acknowledged without retries, and replies are independently observed where the application permits. See [adapter status](ANTIGRAVITY-ADAPTER.md). Do not claim worker execution or task completion from submission alone.

## Phase 0 — Validate the foundation

| Slice | Build | Exit gate |
| --- | --- | --- |
| 0.1 Source audit | Locate Veyrezio source, tests, license/provenance; map reusable concepts | Written reuse inventory; no unexamined code import |
| 0.2 Platform spike | Probe Windows capture, input, windows, scaling, permissions and failure modes | One fixture app observed and controlled; unsupported contexts identified |
| 0.3 Protocol skeleton | Versioned schemas, action state machine, typed errors, contract fixtures | CLI mock and MCP mock return identical outcomes |
| 0.4 Durable runtime | Daemon lifecycle, SQLite migrations, journal and session store | Kill/restart fixture produces honest recovery status |

**Decision gate:** confirm first OS, bridge mechanism and packaging. If the Windows bridge cannot meet safe cancellation or stable targeting, adjust scope before adding providers.

## Phase 1A — Observe before acting

Build runtime status, session identity, capability discovery, display/window metadata, screen capture and artifact access. Add local authentication, restricted artifact storage and audit events at the same time. Exit when a read-only MCP/CLI client can connect, capture, inspect, revoke and restart without losing event integrity. Ship an internal read-only alpha.

## Phase 1B — Controlled computer input

Add window focus, mouse move/click/scroll, keyboard type/hotkey, input lease, stale target checks, held-key cleanup, action deadlines, exact-action approval and emergency stop. Exit when two concurrent sessions cannot interleave input, a focus race is detected, and the fixture workflow can verify a fresh postcondition. No semantic targeting yet.

## Phase 1C — System providers

Add scoped file list/read/write, finite shell execution and plain-text clipboard. Separate delete, process management and arbitrary shell into higher-authority follow-up capabilities. Exit when path escapes, junctions/symlinks, revoked grants, output limits, cancellation and crash recovery pass adversarial tests.

## Phase 1D — Managed browser and verification

Add isolated browser contexts with navigate, locator click/type, capture and explicit downloads. Add typed verification predicates and receipts. Exit when a browser fixture can complete a workflow with an evidence trail, while ambiguous locators and missing postconditions never return `verified`.

## Phase 1E — Semantic assistance and control center

Add OCR/vision candidates and a desktop supervisory UI only after baseline action reliability is measured. Use freshness and confidence checks before converting a candidate into input. Exit when the UI can supervise grants and stop sessions through the same policy path, and semantic target fixtures meet an agreed false-target threshold. Keep vision marked preview if it does not pass.

## ZETRO Computer v1 gate

Pass the [release criteria](EVIDENCE-AND-QUALITY.md#5-release-gates), publish an OS support matrix, stable CLI/MCP schemas, setup/doctor instructions, security review, recovery guide and three end-to-end demos. Any incomplete provider remains clearly marked preview or excluded.

## Phase 2A — Project and adapter foundation

Implement project configuration, profiles, worker registry and generic adapter contract. Build an Antigravity discovery spike to document actual sidecar capabilities and limitations. Exit when an adapter can connect, submit a harmless task and recover its external job identity after restart.

## Phase 2B — Single-worker dispatch

Add assignment validation, worktree lease, finite state machine, adapter submission, progress observation, cancellation and verification commands. Exit when one worker can complete a bounded change in an isolated worktree and produce a reviewable diff/receipt; an uncertain submission stays `unknown` rather than duplicating work.

## Phase 2C — Planning and parallelism

Add planner proposals, dependency graphs and human review. Introduce bounded parallel workers only after single-worker recovery is stable. Exit when independent tasks complete without shared worktree writes, conflicts are surfaced, and queue fairness/cancellation are measured. ORW and AGR naming can live in profiles.

## Phase 2D — Autonomous repair loop

Allow a worker to inspect failed checks, propose a bounded repair attempt and rerun verification. Cap attempts and cost; preserve every attempt's evidence. Exit when failure fixtures stop at the configured limit and never self-certify untested code. Merge, publish and deploy remain separate gates.

## Priority and dependency rules

1. Security, policy and honest result states precede broad computer access.
2. Observation and recovery precede complex input.
3. Deterministic DOM/OS signals precede vision fallback.
4. One reliable worker precedes many workers.
5. Manual review precedes autonomous merge/deploy.

## Next implementation backlog

1. Add managed sidecar packaging for the Antigravity adapter.
2. Inventory old Veyrezio code and capture the Windows bridge capability matrix.
3. Create protocol schemas for `ActionRequest`, `ActionResult`, `Session`, `Grant`, `Event` and `EvidenceReceipt`.
4. Implement the in-memory action state machine and a mock provider, then SQLite journal/recovery.
5. Add one authenticated local interface and a read-only observation provider.
6. Build policy denial fixtures before enabling input or dispatch.

The next runtime milestone should be small enough to demonstrate `start → connect → observe → stop` with a durable event trace. The adapter slice is intentionally narrower: it verifies conversation identity and submits messages, while result observation and dispatch remain future work.
