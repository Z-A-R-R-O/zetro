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
| Veyminore root | `pnpm -r test` | Passed, including RCT 50/50 and adapter 9/9 |
| Veyminore root | `pnpm --dir products/zetro typecheck` | Passed |
| ZETRO standalone temporary copy | `pnpm install --frozen-lockfile` | Passed |
| ZETRO standalone temporary copy | `pnpm -r test` | Passed before the later smoke-test changes; RCT 50/50 and adapter 8/8 |
| ZETRO standalone temporary copy | `pnpm typecheck` | Passed |

The standalone copy excluded the parent repository, `node_modules`, and generated `dist` output. It tested source layout equivalent to a fresh ZETRO clone.

## Initial Linux CI run

The first GitHub Actions runs failed during `pnpm -r test` on Ubuntu, after frozen installation succeeded. The adapter test fixture hardcoded a Windows workspace path (`E:\\Veyminore`) and Windows file URI (`file:///e:/Veyminore`). Those are not a valid matching native path/URI pair under Linux's `fileURLToPath`, so the mock identity checks were platform-dependent. The fixture now uses a platform-native path and `pathToFileURL` to generate its URI.

Authenticated logs from the next Ubuntu run confirmed RCT 50/50 and adapter 7/8. The sole observed failure was the CLI smoke test expecting exit code 0 from `status --json`; the command correctly returned 2 because the CI runner has no live Antigravity connection. The smoke test now accepts the documented success/failure exit semantics and checks that the exit code agrees with the JSON connection states. A separate `--help` smoke test verifies an always-offline CLI path. Live identity checks in the adapter's injected-dependency tests remain unchanged.

The `agent-tools` integration smoke test had the same latent assumption: `status-compact` returns JSON but exits 1 when any Antigravity connection is unavailable. Its subprocess test now parses JSON even on that expected nonzero exit and checks that the exit code agrees with the reported connection states. `send-packed --dry-run` remains offline and must exit 0. Local monorepo and ZETRO-root recursive tests passed after these corrections (RCT 50/50, adapter 9/9). A ZETRO-root test run also passed while pointing the sidecar connection at an intentionally unavailable loopback endpoint, exercising the disconnected path.

## Final Linux CI verification

Both Ubuntu workflows completed successfully on the final code changes: [Veyminore run 38028310590](https://github.com/Z-A-R-R-O/Veyminore/actions/runs/38028310590) at `1dcee7b` and [ZETRO run 38028331267](https://github.com/Z-A-R-R-O/zetro/actions/runs/38028331267) at `8bf48b5`. Each workflow ran a frozen pnpm install, recursive tests, and adapter typecheck without a Groq key or live Antigravity connection.

## Capability boundary

`plan` is a dry-run preflight, not a private-source execution command or isolation guarantee. Offline RCT tests use fixtures and mocked providers. This verification did not call Groq or Antigravity, test live network reliability, or prove multi-worker orchestration. The synthetic `live-fixture` remains an optional network test with possible quota usage.
