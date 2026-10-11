# RCT-2 Offline Verification (2026-10-10)

## Overview

The `rct-runtime` package has been successfully extended with a `run-offline` execution mode capable of deterministically resolving an admitted `rct.assignment.v1` manifest using a strictly mock provider (`FakeProvider`).

**Important Limitation:** There is absolutely no real autonomous live coding logic exposed for private-source execution. `run-offline` consumes predefined mock `_fakeSteps` to produce a reviewable artifact diff without making remote network calls or permanently altering the original source files.

## Commands Executed

* `node src/cli.js run-offline <manifest.json>`
* `pnpm -r test`
* `pnpm --dir products/zetro typecheck`

## Audit Fixes Incorporated

The AGR-3 audit loop identified and corrected several logic gaps that have now been locked down by comprehensive boundary tests:
1. **Explicit Scoped Permissions:** The runtime no longer merges `readPaths` and `writePaths` into a uniform array at execution. The manifest's scope is strictly propagated so that `propose_patch` correctly throws `Path not in write scope` for files configured as read-only.
2. **`review_ready` Safety Enforcement:** Merely submitting a no-op patch (byte-identical) or patching an unrelated path cannot deceive the system into accepting the worker's completion. A valid, applied patch targeting a checked path is strictly required to reach `review_ready` status.
3. **Contains Check Hardening:** Manifest admission rejects `{ type: 'contains', text: '' }` (empty check strings) since they would instantly evaluate as passing.
4. **Before/After Diff Inspection:** The structured artifact receipt printed at execution now actively extracts and surfaces the original `beforeContent` bytes alongside the patched `afterContent`, supporting direct external review rather than returning opaque checksums.
5. **Caller-Asserted Isolation Contract:** The low-level `runAssignment(..., isolatedRoot)` function is documented with an explicit warning emphasizing that `options.isolated = true` is purely caller-asserted; generating the protected snapshot must occur explicitly upstream.

## Results

* `pnpm -r test` successfully completes with 64 exact boundaries explicitly affirmed.
* `pnpm typecheck` successfully completed.
* The original source tree fundamentally remains unchanged throughout the full execution lifecycle.

## Remaining TODO
* **Plan-to-run Stale-Source Injection is untested:** Testing the orchestrator's capability to safely reject execution if files are altered concurrently in the background *between* plan and run boundaries remains a TODO in the test suite (requires sophisticated race-condition mocking outside the scope of `run-offline`).
