# ZETRO architecture

**Status:** proposed · Read with [runtime specification](RUNTIME-SPEC.md) and [security model](SECURITY.md).

## 1. System boundary

```text
Agent client / operator
        │  MCP · CLI · optional HTTP · desktop UI
        ▼
Interface adapters (parse, authenticate, rate-limit; no provider access)
        ▼
Action service (schema → session → policy → approval → scheduler)
        ▼
Executor (provider selection → action → observation → verification)
        ├── Native computer bridge: screen, windows, input, clipboard
        ├── System providers: scoped filesystem, shell, processes
        ├── Browser provider: managed browser contexts
        └── Vision provider: OCR, grounding and visual checks
        ▼
Event store + evidence store + receipts

Phase 2: project/dispatch service → generic worker adapter → external environment
         (calls the same action service for any computer access)
```

The runtime is the authority boundary. A provider is an implementation detail and cannot approve its own use. Interfaces never call providers directly. Adapters may translate external environment operations, but they cannot skip policy or evidence capture.

## 2. Component responsibilities

| Component | Owns | Must not own |
| --- | --- | --- |
| Protocol | Versioned schemas, capability names, error codes | OS implementation |
| Core | Lifecycle, sessions, routing, deadlines, cancellation | UI decisions, Antigravity assumptions |
| Policy | Effective grants, scopes, approval requirements | Action execution |
| Scheduler | Desktop input lease, queue order, conflict and timeout control | Result verification |
| Native bridge | OS capture, window and input operations | Agent/session authority |
| System providers | Shell, files, process operations under supplied scope | Unbounded host access |
| Browser provider | Browser context, tab and locator operations | Raw user profile access by default |
| Vision provider | Candidate targets and confidence/evidence | Authorization or unreviewed clicks |
| Evidence | Artifact capture, integrity, redaction and receipts | Invented outcomes |
| Interfaces | MCP/CLI/HTTP/UI mapping to core | Parallel business rules |
| Orchestration | Projects, workers, dispatch and worktrees | Core computer primitives |

## 3. Dependency direction

`protocol` is the lowest shared contract. `core` depends on protocol abstractions. Providers implement core ports. Interfaces depend on core services. Orchestration depends on core and adapter contracts. The desktop app is a client of runtime services. Cycles and provider-to-interface imports are prohibited.

Native code is a narrow host bridge, not a second policy engine. It receives already authorized, typed requests with resource bounds and returns typed observations/errors. The runtime still validates return data and records the action.

## 4. Proposed repository layout

The product remains under `products/zetro/`; no separate root monorepo is required.

```text
products/zetro/
├── apps/
│   ├── daemon/          # local runtime entry point
│   ├── cli/             # operator and automation commands
│   └── desktop/         # optional Tauri control center
├── packages/
│   ├── protocol/        # JSON schemas/types/errors/versioning
│   ├── core/            # action service, sessions, scheduling
│   ├── policy/          # grants and approval decisions
│   ├── evidence/        # artifacts, redaction, receipts
│   ├── providers/       # filesystem, shell, browser, vision
│   ├── mcp/             # MCP server binding
│   ├── http/            # optional local HTTP binding
│   ├── orchestration/   # Phase 2 dispatch and worktrees
│   └── adapters/        # Phase 2 generic + Antigravity
├── crates/
│   └── computer-bridge/ # OS-specific operations behind stable FFI/IPC
├── tests/
│   ├── contract/
│   ├── integration/
│   ├── security/
│   └── end-to-end/
└── docs/
```

Create only the directories a milestone uses. Product packages may later become `@veyminore/*` shared packages if another real product consumes them.

## 5. Process model and transport

Initial model: one daemon per logged-in operating-system user and interactive desktop, with one event writer, multiple sessions and a single active input lease per desktop. Read-only observations can run concurrently within provider limits. The CLI and MCP server attach as clients to the daemon. The desktop app is a supervisory client, not a privileged bypass.

For MCP, begin with a local **stdio** binding for host-launched clients. Consider streamable HTTP only when a client needs it, with explicit loopback authentication and origin/session checks. Local HTTP, if added, binds to loopback and requires an authenticated client token even on localhost. No unauthenticated control endpoints. The authoritative current MCP transport specification should be checked when implementing; the design intentionally avoids binding core logic to one transport. [MCP transport specification](https://modelcontextprotocol.io/specification/latest/basic/transports)

## 6. State and artifacts

- **SQLite:** session metadata, grants, action journal, events, dispatch state and artifact indexes. Use transactions for state changes. Define schema migrations before release.
- **Artifact directory:** screenshots, traces, diffs and receipts stored outside the database, named by opaque IDs. Store hashes and content types in SQLite.
- **Retention:** configurable per artifact class; default to short retention for raw screenshots and longer retention for redacted metadata. Never put secrets in filenames or logs.
- **Recovery:** on restart, reconcile incomplete action records. Mark outcomes unknown if the external effect cannot be proven.

The event journal is append-only at the application level. Corrections are new events, not edits to old action outcomes. Database encryption at rest is a deployment decision; it must be assessed against OS user permissions and threat model before sensitive data is retained.

## 7. Technology direction and checks

| Area | Candidate | Reason | Validation before lock-in |
| --- | --- | --- | --- |
| Core/CLI/MCP | Node.js + TypeScript | Shared schemas and ecosystem | Package size, startup, crash behavior, MCP host compatibility |
| Native bridge | Rust | Narrow typed OS boundary | Windows capture/input/window spike, FFI/IPC failure behavior |
| Desktop | Tauri | Lightweight supervisory UI | Verify capability permissions and window isolation; keep UI out of authority path |
| State | SQLite | Local transactions and simple deployment | Concurrent reader/writer behavior and crash recovery |
| Browser | Playwright managed context | Locator and browser support | Profile isolation, downloads, permissions, browser install footprint |
| Vision | Provider interface | Swap OCR/grounding models | Accuracy and privacy on real UI fixture set |

Tauri has a capability and permission system for constraining frontend access; ZETRO must also enforce its own session policy in the daemon. [Tauri capabilities](https://tauri.app/security/capabilities/) Playwright supports browser automation across its supported browser engines; the exact browser packaging and profile model remain open decisions. [Playwright library](https://playwright.dev/docs/api/class-playwright)

## 8. Platform constraints to validate

Operating systems differ in screen recording consent, accessibility/input permission, elevation, secure desktops, virtual desktops, display scaling and headless behavior. The first platform's compatibility matrix must explicitly state supported OS versions, display layouts, app privilege levels and session types. The initial release should fail with a clear diagnostic when a capability is unavailable.

## 9. Architectural invariants

1. Policy is evaluated immediately before effect, after all arguments are resolved.
2. A change in target, resolved path, command, amount or recipient invalidates an approval.
3. No action is retried after ambiguous external effect unless its idempotence is proven.
4. Only one session controls the same desktop input channel at a time.
5. Evidence can support a claim but cannot manufacture a successful result.
6. Agent-generated text, webpages and application content are untrusted data, never policy instructions.
7. Phase 2 planning cannot grant capabilities to itself or workers.
