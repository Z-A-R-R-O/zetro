# ZETRO masterplan

**Version:** 0.1 · **Date:** 2026-10-06 · **Status:** proposed product baseline

## 1. Product thesis

ZETRO translates authorized agent requests into local computer actions and returns a traceable account of what happened. The platform reduces the operating system, application and browser detail an agent must handle while preserving user control over powerful actions.

The roadmap has two independent value points:

1. **ZETRO Computer:** a local runtime and agent interface for observation, input, files, shell, browser and verification. A single agent can complete a bounded computer task without Antigravity.
2. **ZETRO Orchestration:** a project-aware CLI and adapters for assigning, tracking and verifying coding work across external agent environments. Antigravity is the first candidate adapter, not a core dependency.

Implementation began with a narrow Antigravity connection adapter at the product owner's request. [ADR-002](decisions/ADR-002-adapter-first.md) changes build order for this slice without changing the long-term runtime boundary or treating a submitted message as verified work.

## 2. Users and jobs

| User | Job | Initial outcome |
| --- | --- | --- |
| Agent developer | Give an agent a stable local tool surface | Connect through MCP or CLI and execute scoped actions |
| Human operator | See and control what an agent is doing | Approve, pause, revoke, inspect evidence and stop a session |
| Automation builder | Run repeatable desktop and system workflows | Submit actions, observe progress and handle typed failures |
| Coding team lead (Phase 2) | Assign work to isolated agents | Dispatch tasks, collect receipts and review changes |

## 3. Product promises

- **One action path.** All transports, interfaces and adapters share validation, authorization, scheduling, execution, observation and audit.
- **Least authority.** Grants bind to a session, principal, capability, resource scope and expiry. No ambient full-computer permission.
- **Evidence-aware results.** `executed` means an operation was attempted and returned; `verified` requires an explicit, relevant postcondition. Unknown outcomes remain unknown.
- **Local first.** The runtime begins on the user's machine, with no required cloud account or telemetry upload.
- **Replaceable providers.** The protocol names capabilities and outcomes; operating-system, browser and vision implementations are replaceable.
- **Finite work.** Every action and dispatch has a deadline, cancellation path, retry policy and terminal result.

## 4. Scope and deliberate sequencing

### Phase 1 minimum useful product

One supported operating system, one interactive desktop session, a local CLI/MCP surface, screen capture, window discovery/focus, mouse/keyboard input, narrowly scoped filesystem and shell actions, sessions, permissions, audit, and observable verification. The first supported platform should be selected by a bridge feasibility spike, with Windows as the initial candidate because the current development environment is Windows.

Browser automation through a managed browser context follows after core desktop control. Semantic vision is a distinct milestone: it must not be a prerequisite for coordinate-based control. HTTP is optional for the first release if MCP and CLI cover the target clients, but its design follows the same runtime contract.

### Phase 1 later capabilities

Semantic targeting, multi-monitor handling, managed browser sessions, process control, desktop dashboard, audio, speech and broader platform support. They enter only after reliability and security criteria for the earlier slice pass.

### Phase 2 minimum useful product

Project configuration, agent registry, one Antigravity adapter behind a generic contract, single-worker dispatch, isolated worktree, bounded execution, verification commands, and a reviewable receipt. Planning workers and parallel queues come after single-worker recovery works.

### Outside the first two releases

Unattended remote control, privileged/system-wide operations, credential extraction, cross-user desktop control, unrestricted browser profile takeover, implicit approval of external publication, autonomous merging/deployment, and guarantees of semantic success without a defined verifier.

## 5. Core experiences

### A. Agent uses the computer

1. Operator starts the runtime and sees its local identity and available capabilities.
2. Agent connects; ZETRO creates a session with a small default grant.
3. Agent observes a screen or window; ZETRO returns metadata and an expiring artifact reference.
4. Agent requests an action with a target and expected observation.
5. Policy checks the requested capability and scope, then gates sensitive effects.
6. The scheduler serializes conflicting desktop actions, executes through a provider, and records an event.
7. A verifier evaluates the postcondition and returns `verified`, `unverified`, or `unknown` with evidence references.

### B. Human supervises

The operator can inspect a pending action with its exact target and effect, approve once or for a narrow scope, deny it, pause input, revoke a grant, stop a session, and export a redacted receipt. Approval is bound to the presented action digest; changed arguments require a new approval.

### C. Agent dispatches coding work (Phase 2)

The operator selects a project profile and worker. ZETRO creates or checks an isolated worktree, sends a finite assignment through an adapter, waits for bounded progress, runs declared verification, records the diff and receipts, and returns a status for human review. Planning output is a proposal; dispatch performs a fresh policy check.

## 6. Success measures

These are target definitions to validate in field use, not measured claims.

| Measure | Target for first usable release | Why |
| --- | --- | --- |
| Action audit completeness | 100% of accepted actions have a terminal event or recoverable interrupted state | No silent execution |
| Policy bypass tests | 0 known paths across CLI, MCP, HTTP and desktop | One authority boundary |
| False verified claims | 0 in the maintained adversarial fixture set | Verification must be trustworthy |
| Cancellation response | Observe and stop further queued work promptly; define numeric SLO after bridge spike | Operator control |
| Crash recovery | Active actions become `unknown` or reconciled, never silently `verified` | Honest state |
| Guided setup | A new operator completes the read-only demo without editing source | Adoption |

Also track denied actions, approval latency, provider failure rates, stale-target failures, and how often users must fall back to manual control. Do not optimize action volume at the cost of false claims or broad grants.

## 7. Reuse audit of Veyrezio

The attachment reports a loopback server, MCP/API access, Antigravity sidecar, desktop bridge, SQLite state, finite dispatch, audit, worktrees and an AGR/ORW division. The source and test evidence are not present in this repository. Treat these as candidates for inspection, not verified assets.

Before copying code, inventory the old repository and record for each component: current behavior, tests, platform assumptions, dependencies, failure modes, security exposure, license/provenance and whether the concept or code should be retained. The new runtime's contracts take priority over compatibility. A thin migration adapter is preferable to importing old Antigravity assumptions into core.

## 8. Decision rules

- Add a provider only when its authority can be scoped and its effects observed.
- Add a high-level action only when target ambiguity and stale state have explicit handling.
- Keep product-specific orchestration in ZETRO until actual reuse across Veyminore products is demonstrated.
- Promote a stable, domain-neutral module to top-level `packages/` only after a second consumer exists.
- Do not expose the local HTTP server beyond loopback by default. Remote access requires a separate design review.
- Record architecture reversals in product ADRs, with migration notes.

## 9. Reading onward

The [architecture](ARCHITECTURE.md) defines module boundaries. The [runtime specification](RUNTIME-SPEC.md) gives implementable contracts. The [security model](SECURITY.md) and [evidence rules](EVIDENCE-AND-QUALITY.md) are release-critical. The [roadmap](ROADMAP.md) turns them into build slices.
