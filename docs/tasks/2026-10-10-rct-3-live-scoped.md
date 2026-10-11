# RCT-3 — gated one-file live provider trial

Owner: AGR-4 coding worker. Coordinator: Codex. Workspace: `E:\Veyminore`.

## Objective

Extend the now-green RCT-2 private-snapshot runner with one explicit, budgeted Groq live mode for a user-approved, single existing file. This is implementation and mocked verification only: **do not make any live provider call yourself**. Codex will choose and run the first approved real task after reviewing your code. Work in `products/zetro/packages/rct-runtime/src`, its tests, and directly relevant scripts only. AGR-5 owns README/verification docs concurrently. Do not commit or push.

## Required gate

- New command may be `run-live <assignment.json> --approve <manifestHash>` or equivalent. It must refuse before network if approval is absent/mismatched, if `dataPolicy.allowRemoteInference` is not true, if provider/model is not an explicit supported Groq selection, if scope has more than one existing file, if createPaths is nonempty, or if budgets exceed a conservative live pilot ceiling (e.g. <= 6 turns, <= 6000 input tokens, <= 2000 output tokens, <= 180000 ms). Honor the lower manifest budgets. Keep `run-offline` network-free.
- Reuse admission, source hash revalidation, `createSnapshot`, and the runtime's distinct read/write scope. Network requests must operate **only on the snapshot** and expose only declared file content via scoped tools. No direct write to source, no arbitrary shell. Run independent checks and require actual changed patch, scoped output, source unchanged before `review_ready`.
- Emit a bounded reviewable artifact/receipt with original and proposed content or diff, changed paths, hashes, checks, usage, failure stage, `remoteUsageUncertain` when appropriate, and source-unchanged verdict. If cleanup or source-unchanged verification fails, never report success.
- No automatic retry of an uncertain provider action; existing provider transport behavior may remain but document it honestly. Do not print API key, bearer tokens, full HTTP bodies, or undeclared source. If `GROQ_API_KEY` absent, fail before network with a clear error.
- Keep the low-level `runAssignment` warning honest: `isolated:true` alone is not proof. Do not imply general private-source readiness or five-worker reliability.

## Tests

Mock the provider, not the public network. At minimum prove gate denial for absent/wrong approval, non-consenting policy, unsupported/missing model, excessive budgets, >1 file, and createPaths. Prove accepted path runs in a private snapshot, leaves source bytes identical, and returns a real review artifact. Check failure/timeout/unknown states do not become `review_ready`. Run package test and report exact results.

## Planned first live task (do not execute)

One approved file: `products/zetro/docs/CAPABILITY-CATALOG.md`. Add a concise `## RCT coding` capability/status paragraph that distinguishes admitted plan, offline snapshot runner, and live one-file pilot; says review-ready is not auto-merge; links to RCT docs. This is a real documentation improvement separate from files currently being edited. The coordinator will create the manifest and decide the exact independent check and budget after your implementation passes review.
