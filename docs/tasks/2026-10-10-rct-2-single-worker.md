# RCT-2 — single-worker snapshot execution

Owner: AGR-5 coding worker. Coordinator: Codex. Workspace: `E:\Veyminore`.

## Objective

Make an admitted `rct.assignment.v1` manifest executable as one bounded coding attempt: `plan` → private snapshot → one provider worker → independent checks → reviewable diff/receipt. The original source tree must remain unchanged. This is an implementation and offline-verification task, **not** authorization to send Veyminore source to Groq or any other remote provider.

## Scope and design constraints

- Work only in `products/zetro/packages/rct-runtime`, its tests, and directly relevant ZETRO docs/package scripts. Do not alter `.agents`, global Antigravity configuration, credentials, Git history/remotes, or other products. Do not commit or push.
- Reuse the existing admission, scoped workspace, snapshot, worker loop, and check code. Keep admission and execution separate; revalidate source paths and source hashes immediately before snapshotting to catch changes since `plan`.
- The first end-to-end CLI mode should be offline and deterministic (`run-offline` or equivalent) with a fake/injected provider and a manifest fixture. Do not make a live API call during tests or this task. A later remote mode must remain fail-closed until explicit per-task source/data/provider consent is implemented and tested.
- Support existing regular files first. If `createPaths` cannot safely execute with current runtime semantics, reject them clearly at execution instead of silently ignoring them. No arbitrary shell commands from the worker.
- Produce a bounded, inspectable artifact containing original/snapshot hashes, changed paths, a reviewable diff or before/after patch, independent check results, usage, completion source, and source-unchanged verdict. `review_ready` requires a real patch, passing checks, scope-clean output, and unchanged source. A model claim is not verification.
- Handle failed checks, stale source, unsafe paths, provider error/timeout, budget exhaustion, and cleanup failure without reporting success. Retain enough metadata to diagnose an ambiguous attempt; never auto-apply the snapshot to source or auto-retry an uncertain provider action.

## Acceptance

1. A command using a small local temporary fixture reaches `review_ready` offline with one changed file, a reviewable artifact, and byte-identical original source.
2. Tests prove source unchanged on success and failure; reject symlink/out-of-scope/missing files, changed source since admission, unsupported creation, and false worker completion.
3. Existing `pnpm -r test` and `pnpm typecheck` pass in both monorepo and standalone ZETRO layout. Add focused CLI/integration tests without network or Antigravity dependency.
4. Update quick start, RCT runtime README, and a dated verification record with exact commands, results, and remaining limits. No claim of private-source live coding or five-worker readiness.

Report the files changed, exact commands/results, any unimplemented acceptance item, and stop if safe implementation requires materially broader scope.
