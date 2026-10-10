# Current Tooling & Quick Start

This document outlines the currently active tools in the ZETRO project, their exact capabilities, boundaries, and how to run them.

## Current Packages & Capabilities

1. **Antigravity Adapter** (`packages/antigravity-adapter`)
   Manages **verified live Antigravity identity/status**. It reads local config and ensures a valid connection, but strictly performs **one-shot submitted sends**.
   
2. **Context Budget** (`packages/context-budget`)
   Evaluates **context packets** to ensure task payloads and references remain within defined token/character limits before dispatch.

3. **Orchestration Core** (`packages/orchestration-core`)
   Provides robust, finite single-worker task queuing and journaling. It currently uses **mock/injected dispatch** via an adapter port to avoid direct Antigravity coupling.

4. **Workspace Runner** (`packages/workspace-runner`)
   Provides local **workspace-runner checks** (such as directory validation and basic environment tests).

5. **Agent Tools** (`apps/agent-tools`)
   Acts as the **adapter and context CLI**. It does *not* orchestrate `orchestration-core` or `workspace-runner` yet.

6. **RCT Runtime** (`packages/rct-runtime`)
   Runs a one-worker offline coding fixture with a fake provider, explicit file scope, hash-checked replacement, independent checks, bounded usage and metadata journal. It also has an authenticated Groq tool-call probe and a **synthetic-only** live coding fixture. Neither command runs private-source tasks. See [package README](../packages/rct-runtime/README.md).

## Runnable Commands

From a clean standalone ZETRO checkout, use Node.js 20+ and pnpm 11.25.0:

```bash
pnpm install --frozen-lockfile
pnpm -r test
pnpm typecheck
```

From the Veyminore monorepo root, use its own lockfile and run `pnpm install --frozen-lockfile` followed by `pnpm -r test`. Execute the following commands from the paths specified.

**Global / Root Execution:**
```bash
# Run tests across all workspace packages
pnpm -r test

# RCT offline pilot (does not use Antigravity or edit repository files)
pnpm --dir products/zetro rct:demo
pnpm --dir products/zetro rct:test

# Dry-run admission of an rct.assignment.v1 JSON manifest; no source edits/network calls
node products/zetro/packages/rct-runtime/src/cli.js plan <manifest.json>

# Synthetic Groq connectivity probe; no network call without GROQ_API_KEY
pnpm --dir products/zetro rct:probe

# Synthetic-only live fixture; requires GROQ_API_KEY and consumes provider quota
pnpm --dir products/zetro rct:live-fixture

# Verify agent-tools capabilities
node products/zetro/apps/agent-tools/src/cli.js verify-all

# Check verified live Antigravity identity status (JSON output)
node products/zetro/packages/antigravity-adapter/dist/cli.js status --json

# Status summary
node products/zetro/apps/agent-tools/src/cli.js status-compact
```

**Exact Context Pack Usage:**
```bash
# Pack and evaluate a context packet
node products/zetro/packages/context-budget/src/cli.js pack --input <task.json> --store <artifact-dir> --budget 2000

# Send the verified context packet (dry-run)
node products/zetro/apps/agent-tools/src/cli.js send-packed AGR-1 --input task.json --store artifact-dir --budget 2000 --dry-run
```

**Package-Specific Testing:**
```bash
# Test Orchestration Core
cd products/zetro/packages/orchestration-core
npm test

# Test Workspace Runner
cd ../workspace-runner
npm test
```

## Strict System Limits

To align with the ZETRO Masterplan and prevent capability overclaim, the following technical limits are explicitly documented:

* **Diagnostic Status:** The current status SQLite database is a **version-specific diagnostic** tool and must not be treated as a stable API.
* **Fire-and-Forget Sends:** The system only supports one-shot submissions. There is **no read-back of completed answers via documented agentapi**. 
* **No Worktree Isolation:** Veyminore and its ZETRO mirror are Git repositories, but the dispatcher does **not** yet create an isolated worktree or verify full dispatch. Shared-environment tasks should not be treated as isolated.
* **Admission Is a Preflight, Not Execution:** `plan` validates manifest shape, scoped paths, and budgets without calling a provider or editing source. It does not authorize private-source live coding. The `live-fixture` command uses generated public data only.
