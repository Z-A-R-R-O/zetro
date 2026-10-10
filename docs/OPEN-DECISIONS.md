# Open decisions and experiments

These are unresolved design choices. Each has an evidence-producing next step; none should silently become a permanent assumption.

| ID | Decision | Current lean | Evidence needed | Decide before |
| --- | --- | --- | --- | --- |
| D01 | First supported OS and minimum version | Windows desktop first | Bridge spike across scaling, permissions, elevated windows, virtual desktops | Phase 1A |
| D02 | Native bridge integration | Rust process over authenticated local IPC | Compare crash isolation, latency, packaging and cleanup against FFI | Phase 0.4 |
| D03 | MCP transport | stdio first | Host compatibility matrix and current protocol spec review | Phase 1A |
| D04 | Initial HTTP API | Defer until concrete client | Client demand, local auth threat review | Phase 1D |
| D05 | SQLite layout and artifact retention | One user database + separate artifacts | Recovery, concurrent reads, privacy review | Phase 0.4 |
| D06 | Browser model | Managed Playwright context | Profile isolation, downloads, packaging, browser consent | Phase 1D |
| D07 | Vision provider | Local-first abstraction | Fixture accuracy, latency, privacy and cost | Phase 1E |
| D08 | Approval UI before desktop app | CLI/prompt mechanism | Usability and headless behavior tests | Phase 1B |
| D09 | Antigravity adapter feasibility | Sidecar where supported | Document actual sidecar API, chat identity and recovery | Phase 2A |
| D10 | Veyrezio code reuse | Concepts first | Source audit, tests, license/provenance and security review | Phase 0.1 |
| D11 | Branding and legacy aliases | ZETRO only for new interfaces | Migration needs from real existing clients | Before public release |
| D12 | Package promotion to Veyminore root | Keep under product | Second real consumer and stable API | When reuse emerges |
| D13 | Remote source for RCT | Synthetic only until explicit approval | Operator choice on Groq data terms and exact source scope | First private-source task |
| D14 | RCT workspace isolation | One private snapshot writer first | Source-hash apply test; decision on Git/worktrees | Parallel writers |
| D15 | RCT default model | GPT-OSS is promising on one fixture, not selected | Repeated synthetic and approved real-task benchmark with verified output/token cost | Default live-worker mode |

## Decision process

For each resolved item, write a short ADR under `docs/decisions/` with context, options, evidence, choice, consequences and a reversal trigger. Update affected specifications in the same change. Do not mark a choice accepted solely because it appeared in the original concept note.

## Questions for the product owner

These do not block writing the initial runtime contract, but they shape implementation priorities:

1. Which computer should ZETRO support first: the current Windows workstation only, or a wider Windows version range?
2. Is the first user only you, or should the first release be installable by other operators?
3. Where is the Veyrezio source and test history, if it still exists?
4. Which concrete first workflow matters most: operating desktop apps, coding through Antigravity, or browser tasks?
5. What data may leave the machine for vision or model providers, if any?

The default plan assumes a single-operator Windows-first local product with no required remote model upload, and treats Antigravity as Phase 2.
