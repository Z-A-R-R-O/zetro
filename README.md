# ZETRO

**Status:** adapter and synthetic RCT pilot in development · **Owner:** Veyminore

ZETRO is a local execution runtime that gives an agent controlled access to a computer, records what it did, and reports what can actually be verified. Its first product is **ZETRO Computer**. The later **ZETRO Orchestration** layer coordinates coding agents and external environments through adapters.

The [Antigravity adapter](docs/ANTIGRAVITY-ADAPTER.md) is the first executable slice. The generic computer runtime and dispatcher remain planned. Other command examples in the plans describe proposed behavior unless explicitly marked implemented.

## Run the current implementation

From this repository root, with Node.js 20+ and pnpm 11.25.0:

```bash
pnpm install --frozen-lockfile
pnpm -r test
pnpm typecheck
pnpm rct:demo
```

`rct:demo` is offline and uses a temporary synthetic fixture. `rct:probe` and `rct:live-fixture` require `GROQ_API_KEY`, make network calls, and may consume quota. The live fixture sends only generated public data. See [Quick Start](docs/QUICK-START.md) and the [RCT runtime README](packages/rct-runtime/README.md) for boundaries and exact commands.

## Read in this order

1. [Masterplan](docs/MASTERPLAN.md) — product strategy, scope, phases, priorities, exit criteria.
2. [Architecture](docs/ARCHITECTURE.md) — components, dependency rules, repository layout, technology decisions.
3. [Runtime specification](docs/RUNTIME-SPEC.md) — action, session, event, interface, and recovery contracts.
4. [Security model](docs/SECURITY.md) — capabilities, consent, sensitive actions, data boundaries, threat model.
5. [Evidence and quality](docs/EVIDENCE-AND-QUALITY.md) — verification claims, receipts, tests, release gates.
6. [Capability catalog](docs/CAPABILITY-CATALOG.md) — operations, authority levels, and milestone mapping.
7. [Operator experience](docs/OPERATOR-EXPERIENCE.md) — CLI, desktop, setup, diagnostics, and recovery.
8. [Orchestration](docs/ORCHESTRATION.md) — Phase 2 project, adapter, worktree, dispatch, and worker model.
9. [Delivery roadmap](docs/ROADMAP.md) — implementation slices with measurable acceptance criteria.
10. [Open decisions](docs/OPEN-DECISIONS.md) — questions requiring experiments before commitment.
11. [Antigravity adapter](docs/ANTIGRAVITY-ADAPTER.md) — implemented commands, live checks and limits.

## Product rule

Every interface routes actions through the same policy and execution pipeline. No UI, CLI, MCP tool, HTTP endpoint, or adapter may call a computer provider directly. A successful input event is not proof that the intended outcome occurred.

## Source and confidence

These documents expand the supplied **“ZETRO — Reborn”** concept. Claims about the old Veyrezio implementation are treated as design input until its source, tests, and operating history are reviewed. See [reuse audit](docs/MASTERPLAN.md#7-reuse-audit-of-veyrezio).
