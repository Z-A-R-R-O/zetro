# ZETRO orchestration specification

**Scope:** Phase 2. Full dispatch requires the Phase 1 action, session, policy and evidence contracts. The [initial Antigravity connection slice](ANTIGRAVITY-ADAPTER.md) was built earlier under [ADR-002](decisions/ADR-002-adapter-first.md); it does not yet dispatch or verify coding tasks.

## 1. Boundary

Orchestration coordinates work in an external coding environment. It does not grant new computer privileges, assume a particular chat count, or claim a worker completed a task because it said so. The first adapter may be Antigravity, but core dispatch addresses a generic worker contract.

```text
User request → optional planner proposal → validated assignment
             → policy/approval → worktree lease → worker adapter
             → bounded execution → independent checks → receipt → human review
```

## 2. Project model

A ZETRO project is an explicit configuration rooted in a repository or working directory. It records project ID, canonical root, allowed worktree parent, profile, worker mappings, verification commands, resource limits and granted capabilities. Project selection in a CLI must not silently switch the active project of another process or session. A project-local `.zetro/` may hold nonsecret configuration; session databases, tokens, logs and raw evidence belong in the user's runtime data directory and are referenced by IDs.

Example proposed `project.json`:

```json
{
  "schemaVersion": "0.1",
  "id": "intergrid",
  "root": "C:/work/intergrid",
  "profile": "default",
  "worktreeParent": "C:/work/intergrid-worktrees",
  "verification": ["pnpm test", "pnpm build"],
  "maxConcurrentWorkers": 1
}
```

Paths and commands are illustrative. In implementation, use structured command arrays rather than shell strings where possible, and canonicalize all paths. A project profile is data and cannot override the runtime security floor.

## 3. Worker and adapter contracts

A worker record has a stable ID, role, provider/adapter, project scope, capability budget, concurrency limit and health state. `AGR-1` through `AGR-5` are optional profile labels, never global runtime roles. An ORW planner is a planner type, not an execution authority.

Adapter interface:

- `probe()` — check installation, connectivity, capabilities and limitations.
- `connect(project, session)` — establish bounded external context.
- `submit(assignment)` — send one immutable task payload, returning external job ID.
- `observe(jobId, cursor)` — return progress and evidence candidates.
- `cancel(jobId)` — best-effort cancellation, with honest result.
- `close()` — release resources.

Adapters return typed events. They do not write `verified` status; ZETRO's verifier does. The Antigravity adapter must document sidecar discovery, chat creation/renaming constraints, conversation identity stability, output capture and disconnect/reconnect semantics before dispatch is enabled. If an operation is unsupported, expose the limitation instead of automating a brittle UI workaround without evidence.

## 4. Assignment contract

Each assignment includes `taskId`, project, worker selector, objective, acceptance criteria, allowed paths, worktree policy, capability budget, deadline, verification plan and idempotency key. Reject vague assignments that have no bounded outcome or review path. A planner may propose these fields; a user or controlling agent approves the actionable assignment according to project policy.

Dispatch states: `draft → validated → awaiting_approval → queued → preparing → running → verifying → review_ready | failed | cancelled | unknown`. State changes are journaled. Retries create a new attempt with a link to the previous attempt. Never replay a submission if the external environment may have accepted it; first reconcile by external job ID.

## 5. Worktree and file isolation

One active worker owns a worktree lease. Before dispatch, ZETRO checks repository status, base commit, target branch, worktree path and collisions. The worker may edit only its assigned worktree and declared external resources. After execution, ZETRO records base/head commits, changed paths, diff summary, untracked files and verification results. It does not reset or delete a dirty worktree automatically. A merge is a separate human-reviewed operation, outside the first orchestration release.

The first release uses one worker at a time. Parallel jobs later require file ownership or merge conflict policy, per-worker resource budgets, fair scheduling, dependency graph semantics and recovery of partially completed assignments.

## 6. Planning layer

An ORW or other planner can research, decompose work, estimate dependencies and propose assignments. Its output is untrusted task data. ZETRO validates path scope, worker availability, capability budget, acceptance criteria and task graph acyclicity before dispatch. The planner cannot authorize itself, expand grants, disable tests or change evidence status.

The initial planner should produce a small, reviewable dependency graph rather than a fixed number of workers. It should prefer fewer independent tasks with clear file ownership. Decomposition quality is assessed by completion without conflicts, review time and unnecessary rework, not by worker count.

## 7. Verification and receipt

The orchestration receipt includes objective, accepted criteria, assignment digest, worker/adapter IDs, project and worktree identity, base/head state, external job ID, action/event timeline, changed files, commands/tests with exit codes, artifact hashes, unresolved failures, and per-criterion status. `verified` means all declared machine-checkable criteria passed and no required observation is missing. Human judgment remains explicit for design or semantic criteria.

Example human summary:

```text
Task: Add dashboard navigation
Dispatch: completed
Worktree: isolated, base commit recorded
Tests: 18 passed, build passed
Diff: 7 files, 210 additions, 34 deletions
Acceptance: route links checked; visual polish needs review
Result: review_ready (partially verified)
```

## 8. CLI surface and recovery

Proposed commands: `zetro project add|list|use|status`, `zetro agent list|probe`, `zetro connect <adapter>`, `zetro dispatch <assignment>`, `zetro dispatch status|cancel <id>`, `zetro evidence show|export <id>`. All machine-oriented commands support JSON output and stable exit codes.

On restart, reconcile queued work from the journal, check worktree leases and ask adapters for external job state. If the adapter cannot prove whether a submission happened, mark the attempt `unknown` and require operator review before any retry. Do not issue a duplicate coding task automatically.
