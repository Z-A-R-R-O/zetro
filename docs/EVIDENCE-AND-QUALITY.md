# Evidence, verification and quality

**Status:** proposed release contract

## 1. Claims ZETRO may make

| Claim | Meaning | Minimum evidence |
| --- | --- | --- |
| `accepted` | Request passed schema and entered workflow | Action journal entry |
| `authorized` | Effective policy allowed this exact request | Policy decision ID and grant/approval reference |
| `executed` | Provider attempted the effect and returned success | Provider result plus timestamps |
| `verified` | Fresh observation satisfied a declared postcondition | Predicate, observation ID, evaluator result |
| `unverified` | Postcondition ran and failed | Predicate and observed mismatch |
| `unknown` | Effect or postcondition cannot be established | Reason and last durable event |

These claims are independent. `executed` never implies `verified`; a zero exit code verifies only the process exit condition unless another postcondition is defined. A screenshot after a click is evidence of the screen state, not proof the click caused it. Human confirmation is a valid verifier only if its identity and exact statement are recorded.

## 2. Verification plan

An action can declare one or more predicates. Predicates are typed and evaluated against fresh observations: `window.active`, `text.visible`, `element.state`, `file.exists`, `file.hash`, `command.exitCode`, `process.state`, `diff.present`, `test.passed`, and `human.confirmed`. Each predicate specifies source, timeout, polling strategy and freshness requirement. Verification combines predicates with explicit `all`/`any`; default is `all`. An unavailable or stale observation yields `unknown`, not pass.

For semantic desktop actions, the initial observation identifies a target; the post-action observation must be new. A vision provider reports candidate confidence and raw provenance. Verification uses a separate check where possible, avoiding a single model's self-confirmation. For coding tasks, successful tests and a nonempty diff are useful but insufficient alone to prove that a feature meets user intent; the receipt identifies which acceptance criteria were independently checked and which require review.

## 3. Evidence receipt

```json
{
  "receiptVersion": "0.1",
  "actionId": "act_01...",
  "sessionId": "zt_01...",
  "principal": "local-client:codex",
  "requestDigest": "sha256:...",
  "policyDecisionId": "pol_01...",
  "startedAt": "2026-10-06T16:00:00Z",
  "completedAt": "2026-10-06T16:00:01Z",
  "effect": "executed",
  "verification": "verified",
  "checks": [{ "kind": "text.visible", "result": "pass", "observationId": "obs_01..." }],
  "artifacts": [{ "id": "ev_01...", "sha256": "...", "redacted": true }]
}
```

Receipts are immutable summaries linked to append-only events. Hashes detect accidental alteration; they are not a substitute for a trusted storage boundary or signing. Export redacts secrets and discloses any omitted artifacts. A receipt can be superseded by a later corrective event; its original claim remains visible.

## 4. Test strategy by layer

| Layer | What to test | Examples |
| --- | --- | --- |
| Schema/contract | Same request/result semantics across interfaces | Unknown fields, malformed targets, version negotiation |
| Policy | Every capability and scope boundary | Revocation, expiry, path escape, changed approval digest |
| Core state | Action transitions and crash recovery | Restart after journal intent, cancellation while queued/running |
| Provider contract | Typed failures and resource cleanup | Window vanishes, screen permission revoked, held key release |
| Desktop integration | Real OS effects in controlled fixture app | Scaling, focus race, multi-window target changes |
| Browser integration | Managed context behavior | Locator ambiguity, navigation, downloads, session isolation |
| Verification | No false positive on stale or unrelated evidence | OCR ambiguity, failed test, missing diff, wrong active window |
| Security/adversarial | Hostile clients/content | Loopback CSRF, prompt injection, concurrent agents |
| End to end | Operator journey | Start → grant → observe → act → verify → revoke → export |

Use deterministic fixture applications and synthetic displays where feasible, plus a small physical-machine smoke suite for OS behavior that cannot be simulated. Record OS version, display scale, permissions and provider version with failures.

## 5. Release gates

### Internal alpha: read-only runtime

Session creation, status, screen/window observation, local interface auth, audit and retention work. No input or shell exposed. Crash recovery preserves honest state. Operator can revoke a session.

### Controlled beta: computer actions

Input, files and shell pass the policy/security matrix; action effects are journaled; cancellation and emergency stop work; a demo workflow reports `verified` only for a real postcondition. The same denial appears through all enabled interfaces.

### ZETRO Computer v1

Supported OS matrix is documented, setup and doctor are usable, known provider failure modes have typed errors, evidence export is redacted, compatibility/contract tests pass, and a new operator completes three representative workflows without developer intervention. Browser and semantic vision are included only if they meet the same gates; otherwise they remain preview capabilities.

### ZETRO Orchestration v1

One adapter and one worker can execute a finite task in an isolated worktree; cancellation/restart yields an honest terminal status; verification commands and diff are captured; a reviewer can inspect the receipt and choose whether to merge. Parallel dispatch is a later gate.

## 6. Operational observability

Expose counters for action outcomes, policy denials, approvals, provider failures, verification failures, queue wait, execution duration, artifact size and recovery events. Logs use correlation IDs and redact arguments according to capability class. A diagnostic bundle requires explicit operator export and previews included data before sharing.
