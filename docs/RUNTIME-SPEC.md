# ZETRO runtime specification

**Status:** design contract v0.1. Fields and names are proposed and will be versioned before implementation.

## 1. Runtime lifecycle

States: `starting → ready → draining → stopped`, with `degraded` and `failed` as observable conditions. `ready` requires a writable state store, policy engine and at least one healthy observation provider. Input can be unavailable while the runtime is `degraded`; capabilities report their own availability and reason.

Startup opens the database, applies compatible migrations, reconciles interrupted actions, binds local interfaces, probes providers and publishes status. Shutdown rejects new actions, cancels queued work, asks active work to stop within a deadline, flushes events, releases input keys/buttons, closes interfaces and stores a terminal runtime event. A forced crash takes the recovery path on next start.

## 2. Universal action envelope

Every mutation or observation uses the same envelope, regardless of interface:

```json
{
  "protocolVersion": "0.1",
  "actionId": "act_01...",
  "sessionId": "zt_01...",
  "kind": "mouse.click",
  "target": { "displayId": "display_1", "x": 842, "y": 512 },
  "arguments": { "button": "left" },
  "expected": { "kind": "text.visible", "value": "Submitted", "timeoutMs": 5000 },
  "deadlineMs": 10000,
  "idempotencyKey": "client-chosen-opaque-key"
}
```

`sessionId`, `kind`, `deadlineMs` and typed target/arguments are required. `expected` is optional; without it, ZETRO cannot claim semantic success. `idempotencyKey` deduplicates transport retries but does not make a non-idempotent effect safe to replay. The server assigns `actionId` if absent. Unknown fields are rejected for sensitive actions. Coordinates are in a documented display coordinate space and carry display identity and observation revision when possible.

### Response contract

```json
{
  "actionId": "act_01...",
  "state": "completed",
  "effect": "executed",
  "verification": "verified",
  "observedAt": "2026-10-06T16:00:00Z",
  "evidenceIds": ["ev_01..."],
  "error": null
}
```

`state` is workflow state: `accepted | awaiting_approval | queued | running | completed | denied | cancelled | expired | interrupted`. `effect` is `not_attempted | executed | failed | unknown`. `verification` is `not_requested | verified | unverified | unknown`. The result exposes these axes separately. A shorthand `ZTR_RESULT`/`ZTR_STATUS` may be rendered for people, but never replaces structured fields.

### Typed errors

At minimum: `INVALID_REQUEST`, `UNSUPPORTED_CAPABILITY`, `PERMISSION_DENIED`, `APPROVAL_REQUIRED`, `TARGET_AMBIGUOUS`, `TARGET_STALE`, `INPUT_BUSY`, `PROVIDER_UNAVAILABLE`, `DEADLINE_EXCEEDED`, `ACTION_CANCELLED`, `EFFECT_UNKNOWN`, `VERIFICATION_FAILED`, `RATE_LIMITED`, `INTERNAL_ERROR`. Errors include retryability, a safe message and a correlation ID. Internal details stay in restricted logs.

## 3. Action pipeline

```text
parse → validate → resolve session/principal → resolve target/resource
      → evaluate policy → request approval if needed → revalidate target/policy
      → acquire resource lease → journal intent → execute
      → observe → verify → persist receipt → release lease → respond
```

The journal intent precedes a side effect. Every accepted action reaches a terminal state or an `interrupted` record. On restart, ZETRO may reconcile read-only operations; it must report `effect: unknown` for a possibly completed side effect lacking reliable proof. Cancellation stops future steps and best-effort stops the current provider call; it does not imply reversal of effects already performed.

## 4. Sessions and capabilities

A session records an opaque ID, creator identity, creation/expiry, runtime instance, allowed project/work directory, grants, active leases, action history and revocation state. Agent-supplied labels are descriptive only. Session IDs are not authorization secrets. Reconnect requires the original authenticated principal or an explicit handoff.

Grants are tuples of `principal + session + capability + resource scope + expiry + approval conditions`. Examples: `screen.capture` on display 1, `fs.read` under one resolved directory, `shell.exec` for a constrained command profile, `browser.navigate` in one managed context. Deny takes precedence. A revoked or expired grant prevents queued actions from executing.

## 5. Computer model

An observation snapshot has a monotonically increasing revision, timestamp, display geometry and scale, active window identity, cursor position, held input state and capability availability. Window identities are opaque handles tied to a process/window generation; titles alone are never unique identifiers. A focus or click action can require the revision it observed, with a stale-target error if the desktop changed materially.

Desktop input is globally serialized by an input lease. A session may hold the lease only for a short bounded action or transaction, not indefinitely. When a lease ends unexpectedly, the bridge releases held keys and buttons. Read-only capture can proceed concurrently if the provider supports it, but each image must state which desktop revision/time it represents.

## 6. Provider contract

Each provider implements `probe()`, `describeCapabilities()`, `execute(request, cancellation)`, `observe()` where applicable, and `close()`. Providers return typed outcomes and never throw across the core boundary without conversion to a typed error. Core owns scheduling, policy, audit and verification. Native bridge crashes degrade the affected capabilities; they do not restart an action automatically.

### Initial operations

| Capability | First slice | Later expansion |
| --- | --- | --- |
| Screen | displays, capture, region | change detection, OCR, semantic find |
| Windows | list, active, focus | move, resize, close |
| Mouse | position, move, click, scroll | drag, press/release, semantic target |
| Keyboard | type, press, hotkey | explicit key down/up, clipboard-assisted paste |
| Clipboard | read/write with consent and redaction | formats beyond plain text |
| Filesystem | list, read, write with atomic replacement | move, copy, patch, delete |
| Shell | finite command execution, cwd, output streaming | managed long-running processes |
| Browser | managed context, navigate, locator click/type, capture | tab/session reuse, downloads |
| Vision | OCR/target candidates, confidence | multimodal model selection |

For files, resolve paths canonically at execution time and enforce scope after resolution, including symlinks and junctions. Writes should use a temporary file plus atomic replacement where supported. Deletes are separate gated actions. Shell commands run as the current OS user in an explicit working directory, with bounded output and deadline; they do not become sandboxed merely because ZETRO checked a capability.

For browser automation, prefer DOM/accessible locators in a managed context. Use visual coordinates only when the DOM path is unavailable. Never quietly attach to a personal browser profile. A screenshot or page text is untrusted content.

## 7. Semantic targeting and verification

`find("Submit")` returns candidates with source (`accessibility | DOM | OCR | vision`), bounding box, display/window, snapshot revision and confidence. It does not click. `clickTarget(candidateId)` checks expiry, window identity, snapshot revision and ambiguity, then performs a policy check for the resulting click. Low confidence or multiple plausible targets requires agent clarification or a new observation. A model confidence score alone is not verification.

Verification is a separate predicate over a fresh observation, such as text visible, file hash changed, process exited zero, or expected DOM state. The verifier stores its inputs, predicate, result and timestamp. A side effect with no relevant predicate returns `verification: not_requested`; a predicate that cannot run returns `unknown`.

## 8. Events, storage and subscriptions

The event stream is ordered per session and carries `eventId`, timestamp, runtime/session/action IDs, principal, event type, redacted attributes and correlation ID. Core events include `action.accepted`, `policy.denied`, `approval.requested`, `action.started`, `provider.result`, `verification.result`, `action.completed`, `session.revoked`, `runtime.recovered` and `artifact.deleted`. Secret values and raw screenshots are stored as controlled artifacts, not embedded in events.

Subscribers resume from an event cursor. Slow consumers receive bounded buffers and a gap signal, then fetch history; the runtime never blocks action execution indefinitely to serve a client. Retention and export rules are in [Security](SECURITY.md).

## 9. Interfaces and compatibility

- **CLI:** operator commands `zetro start|stop|status|doctor`, `session`, `grant`, `actions`, `evidence`; Phase 2 adds project/agent/dispatch. Human-readable by default, `--json` for automation.
- **MCP:** tools map to actions with typed schemas. Tool responses include action ID, effect, verification and evidence references. Large images use resource/artifact references where supported; no policy logic in tool handlers.
- **HTTP:** optional local binding: `GET /v1/health`, `GET /v1/status`, `POST /v1/sessions`, `POST /v1/actions`, `GET /v1/actions/{id}`, `GET /v1/events`, `GET /v1/artifacts/{id}`. Mutating endpoints authenticate and authorize. `health` reveals minimal data.
- **Desktop:** subscribes to events and calls the same APIs for approval, revocation and stop. No privileged hidden command channel.

Version the action schema and transport bindings. Additive fields are compatible within a protocol version; changed semantics or removed fields require a new version and migration window. Preserve a contract fixture corpus across CLI/MCP/HTTP so the same request yields the same policy and result semantics.

## 10. Operational limits

Define defaults and configurable maxima for action deadline, queue length, screenshot size, shell output, artifact retention, active sessions and per-principal rate. Refuse requests exceeding limits with typed errors. `doctor` reports missing permissions, bridge health, database integrity and binding state without dumping secrets.
