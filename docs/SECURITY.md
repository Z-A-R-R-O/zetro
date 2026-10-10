# ZETRO security model

**Status:** release-critical design contract. The first implementation must test these rules before exposing mutating actions.

## 1. Assets and trust boundaries

Protect the user's files, credentials, desktop input, clipboard, screen content, browser sessions, network identity, local audit records and authority to send or publish. The adversary may be a malicious client, compromised agent prompt, hostile webpage/document, local process able to reach loopback, compromised adapter, or a legitimate agent making an unsafe mistake. Assume model output and external content can contain instructions that conflict with the operator's intent.

Trust boundaries: client → local interface; interface → authenticated session; session → policy; policy → provider; provider → OS/app; observation/artifact → client. Crossing each boundary requires explicit validation. Operating as the logged-in user does not make shell or desktop actions safe by default.

## 2. Default authority

New sessions receive minimal metadata access: runtime health, their own session and available capability descriptions. Screen content, window titles, input, clipboard, files, shell, browser and process control require grants. Grants are narrow in action, resource, duration and principal. Deny takes precedence over allow. A change to a resolved resource or command requires reevaluation.

| Class | Example | Default behavior |
| --- | --- | --- |
| Metadata | `runtime.status` | Allowed to authenticated local principal, minimal fields |
| Observe | `screen.capture`, `fs.read`, `clipboard.read` | Explicit scoped grant; sensitive sources may need one-time consent |
| Mutate local | `mouse.click`, `keyboard.type`, `fs.write` | Explicit scoped grant, action audit |
| Execute | `shell.exec`, browser script, process start | Narrow command/environment grant and finite deadline |
| Irreversible/external | delete, send message, purchase, publish, deploy | Exact-action approval unless a narrowly preauthorized policy explicitly covers it |
| Privileged | elevation, secure desktop, credential extraction, shutdown | Unsupported in initial releases |

The policy engine maps high-level intents to actual low-level effects. A semantic `click("Delete")` is a click with a potentially destructive target; granting `mouse.click` alone must not silently authorize a known destructive operation. Since intent detection can fail, use defense in depth: sensitive workflows require scoped grants, UI confirmation when detectable, and human review where the outcome is high impact. Do not claim the system can perfectly infer intent from pixels.

## 3. Approval protocol

An approval request displays principal, session, action, resolved target, arguments, likely effect, scope, expiry and evidence available so far. The operator approves or denies a cryptographic digest of that exact normalized request. Approval is one-use by default. A time-limited grant requires explicit scope and duration, and is revocable. Approval expires when focus, target, path, command or session changes. Headless clients cannot approve their own pending requests.

If the UI is unavailable, return `APPROVAL_REQUIRED` and wait or fail within the action deadline. Never silently promote the request. Emergency stop revokes active input grants, clears queued actions, signals running providers to cancel and releases held keys/buttons; effects already committed may remain.

## 4. Interface hardening

- Bind HTTP to loopback only by default. Require per-client authentication and authorization; check request origin/host, reject cross-site calls and rotate tokens. Do not treat localhost as a trusted identity.
- Use process-local/OS-protected IPC where available. Protect token files with user-only permissions and avoid printing tokens in logs or `doctor` output.
- MCP `stdio` inherits the launching host's local process context; still create an explicit principal/session with grants. MCP tools expose only granted capabilities and return typed denials.
- Rate-limit actions, approvals, artifact reads and connection attempts. Limit image sizes and shell output.
- A desktop WebView receives only UI capabilities it needs. Tauri's capabilities help restrict frontend access, but daemon policy remains authoritative. [Tauri capability model](https://tauri.app/security/capabilities/)

## 5. Data handling

Screen captures, clipboard text, command output, browser content and evidence can contain secrets. Store raw artifacts under user-only permissions with opaque names, short default retention and explicit export. Redact known secret patterns in logs, but assume pattern redaction is incomplete. Prefer metadata and hashes over raw content when they establish the same fact. A receipt should reference sensitive artifacts through access-controlled IDs, not inline them.

No remote telemetry or model upload is required for the first release. A cloud vision provider, if later added, must disclose what pixels/text leave the computer, require an operator grant and support a local-only mode. Deleting a session does not necessarily delete audit records; define retention and deletion policy before implementation.

## 6. Prompt injection and untrusted observations

Webpages, documents, terminal output, chat content and OCR text are data. They may ask the agent to ignore prior instructions, exfiltrate secrets or change permissions. ZETRO never interprets them as grants or policy. The agent client may still be influenced; therefore ZETRO enforces filesystem/network/command scopes at effect time and gates external transmission. Evidence labels content origin so the client can distinguish operator instruction from observed data.

Planning workers and adapter responses are equally untrusted. A planner may propose a task but cannot create an approval, expand worker grants or mark work verified. An adapter may report that it sent a prompt; only independent observations/tests support completion.

## 7. Resource-specific controls

- **Filesystem:** canonicalize paths at use time; reject escapes through symlinks, junctions and `..`; separate read/write/delete; restrict roots; defend against time-of-check/time-of-use changes where possible.
- **Shell:** accept explicit working directory, environment allowlist and deadline; redact output; disallow elevation initially. A command profile is safer than unrestricted arbitrary command text, though arbitrary shell may be enabled with an explicit high-authority grant.
- **Browser:** use a managed context by default; isolate cookies/downloads; gate downloads and external messages; do not attach to a personal profile without a separate design and consent flow.
- **Desktop input:** serialize input; confirm active window/target generation; release held keys on failure; never inject into secure desktop or higher-privilege windows in the first release.
- **Clipboard:** treat reads as sensitive, writes as mutating; clear temporary secrets only when ZETRO can prove it owns the current clipboard value.
- **Vision:** confidence is advisory; reobserve before acting; never let the model return an executable coordinate as an authorization decision.

## 8. Threat and test matrix

| Threat | Control | Required test |
| --- | --- | --- |
| Malicious localhost webpage calls API | Auth, origin/host checks, CSRF protections | Cross-origin and forged-host requests denied |
| Symlink/junction escapes allowed root | Canonical resource scope at execution | Attempt read/write outside root through link denied |
| Agent replays approved action with changed target | Approval digest + one-use token | Mutated and replayed approval denied |
| Two agents race mouse/keyboard | Global input lease + focus recheck | Interleaved sessions cannot cross-control |
| Hostile page instructs secret upload | Treat page as data; effect-time scope and external gate | Injection fixture cannot gain new grant |
| Bridge crashes after click | Journal intent; uncertain effect status | Recovery reports `unknown`, never false success |
| Sensitive screenshot retained or leaked | Restricted artifact access/retention | Unauthorized retrieval and expired artifact fail |
| Adapter claims work complete without diff/tests | Independent verifier | Receipt remains unverified |

## 9. Release rules

Mutating interfaces stay disabled until the policy bypass matrix passes for every exposed transport. A new provider capability requires threat review, policy mapping, denial tests and an operator-facing permission description. See [quality gates](EVIDENCE-AND-QUALITY.md).
