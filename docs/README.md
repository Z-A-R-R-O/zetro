# ZETRO documentation map

| Document | Owns | Update when |
| --- | --- | --- |
| [Current Tooling & Quick Start](QUICK-START.md) | Runnable commands, live packages, and strict current limits | Packages are added or limits lifted |
| [Masterplan](MASTERPLAN.md) | Product intent, boundaries, success, phase gates | Strategy or scope changes |
| [Architecture](ARCHITECTURE.md) | Component ownership, dependencies, platform choices | Modules or technical direction change |
| [Runtime specification](RUNTIME-SPEC.md) | Machine-readable behavior of actions, sessions, events, interfaces | API or runtime semantics change |
| [Security model](SECURITY.md) | Trust boundaries, capability rules, consent and data handling | Any new power or access path is added |
| [Evidence and quality](EVIDENCE-AND-QUALITY.md) | Verification claims, testing and release criteria | Result semantics or quality bar changes |
| [Capability catalog](CAPABILITY-CATALOG.md) | Operation list, scope, risk and phase | Tools are added or reclassified |
| [Operator experience](OPERATOR-EXPERIENCE.md) | Setup, CLI, dashboard, approvals and recovery | User-facing workflow changes |
| [Orchestration](ORCHESTRATION.md) | Phase 2 projects, workers, adapters and dispatch | Multi-agent behavior changes |
| [Roadmap](ROADMAP.md) | Build order and milestone acceptance | Priorities or delivery estimates change |
| [Open decisions](OPEN-DECISIONS.md) | Unresolved choices and required experiments | An assumption is confirmed or rejected |
| [Decision records](decisions/README.md) | Accepted product architecture choices | A choice is made or reversed |
| [Antigravity adapter](ANTIGRAVITY-ADAPTER.md) | First executable slice and live connection evidence | Adapter behavior or Antigravity support changes |
| [RCT plan](RCT-PLAN.md) | In-built coding-worker phases and provider choice | RCT runtime, safety gates or benchmarking changes |

## Change control

The runtime specification defines behavior; the masterplan defines intent. If they disagree, resolve the disagreement in an ADR before implementation. Examples are illustrative until their schema is implemented and tested. All dates, ports, performance targets and technology choices are proposals unless marked accepted.
