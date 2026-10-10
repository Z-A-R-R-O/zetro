# ZETRO stabilization verification — 2026-10-10

## Implemented

- RCT admission CLI tests resolve `src/cli.js` relative to the test module, so they work from the package, ZETRO, and monorepo roots.
- Admission rejects nonexistent or inaccessible `source.root`, missing `readPaths`/`writePaths`, and symlink or junction components across read, write, and create scopes. `createPaths` alone may refer to a path that does not yet exist.
- `agent-tools` declares the adapter as a workspace dependency. This orders its integration test after the adapter build during recursive tests.
- ZETRO has its own pnpm workspace, lockfile, and CI workflow. The monorepo has a separate CI workflow; both use frozen installs, recursive tests, and adapter typechecking.

## Verified commands

On Windows with Node.js and pnpm 11.25.0:

| Location | Command | Result |
| --- | --- | --- |
| Veyminore root | `pnpm install --frozen-lockfile` | Passed |
| Veyminore root | `pnpm -r test` | Passed, including RCT 50/50 and adapter 8/8 |
| Veyminore root | `pnpm --dir products/zetro typecheck` | Passed |
| ZETRO standalone temporary copy | `pnpm install --frozen-lockfile` | Passed |
| ZETRO standalone temporary copy | `pnpm -r test` | Passed, including RCT 50/50 and adapter 8/8 |
| ZETRO standalone temporary copy | `pnpm typecheck` | Passed |

The standalone copy excluded the parent repository, `node_modules`, and generated `dist` output. It tested source layout equivalent to a fresh ZETRO clone.

## Initial Linux CI run

The first GitHub Actions runs failed during `pnpm -r test` on Ubuntu, after frozen installation succeeded. The adapter test fixture hardcoded a Windows workspace path (`E:\\Veyminore`) and Windows file URI (`file:///e:/Veyminore`). Those are not a valid matching native path/URI pair under Linux's `fileURLToPath`, so the mock identity checks were platform-dependent. The fixture now uses a platform-native path and `pathToFileURL` to generate its URI. Local monorepo and ZETRO-root recursive tests passed after this correction. A new Linux Actions run is required to confirm CI is green; Linux was not available locally for execution.

## Capability boundary

`plan` is a dry-run preflight, not a private-source execution command or isolation guarantee. Offline RCT tests use fixtures and mocked providers. This verification did not call Groq or Antigravity, test live network reliability, or prove multi-worker orchestration. The synthetic `live-fixture` remains an optional network test with possible quota usage.
