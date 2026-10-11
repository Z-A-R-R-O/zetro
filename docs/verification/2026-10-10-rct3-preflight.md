# RCT-3 Preflight Verification

## Scope & Target
- **Target File**: `docs/README.md`
- **Manifest**: `docs/tasks/2026-10-10-rct-first-live.json`
- **Model**: `openai/gpt-oss-120b` (via Groq)
- **Budgets**: `maxOutputTokens: 2000`, `maxTurns: 5`, strict ceilings applied.
- **Constraints**: Scope is restricted strictly to a single file. `createPaths` is empty. The exact `source.expectedSha256` of `docs/README.md` is pinned to ensure deterministic validation.

## Mock Tests & Preflight Audit
- **Mock Tests**: Executed focused boundary tests using the offline `run-offline` CLI with simulated provider responses. Ensured that unsupported creation, invalid paths, out-of-scope edits, and read-only modifications are deterministically rejected. (Read-only scope and snapshot integrity defects were previously identified and fixed in RCT-2).
- **AGR-3 Audit (Initial NO-GO)**: The initial RCT-3 preflight identified three blockers:
  1. Approval hash did not pin exact source bytes.
  2. Groq HTTP 5xx usage uncertainty was misreported.
  3. Full-file artifact was printed to stdout.
- **Findings Fixed & Re-Audit (GO)**: Adjustments were made to runtime constraints. `source.expectedSha256` was introduced for direct source byte validation, the stdout leak was fixed, and 5xx usage tracking was corrected. A re-audit granted GO for **one single scoped trial**.

## Verified Command Outcomes
Exact verified command outcomes as of now:
- `node --test packages/rct-runtime/test/*.test.js`: 65 pass, 0 fail, 1 TODO
- `pnpm -r test`: pass
- `pnpm --dir products/zetro typecheck`: pass
- `git diff --check`: pass

## Source & Execution Status
- **Source Unchanged**: Throughout testing and preparation, the target file (`docs/README.md`) remained unmodified as required.
- **Live Trial**: The live trial has **not yet run** because the provider API key is absent. No live request has been made. The environment is fully scoped, budgeted, and verified for one single scoped trial.
