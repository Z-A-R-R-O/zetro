# RCT: in-built coding workers — implementation masterplan

**Status:** offline single-worker slice implemented; live Groq connection verified by operator; Qwen failed the exact synthetic fixture; GPT-OSS made the correct edit, but verifier auto-finalization awaits a live rerun. No private-source task has run.  
**Date:** 2026-10-08  
**Owner:** ZETRO. The five Antigravity conversations are paused and are not RCT workers.

## 1. Decision and objective

RCT is the proposed **in-built worker mode**: ZETRO runs a bounded local coding-agent loop while an online model API supplies inference. This is an assumption about the name “RCT,” not an expansion of the acronym. It must not be a thin wrapper that blindly forwards prompts to a model and trusts its claim of completion.

Modes share one assignment, evidence, policy, and verification contract:

| Mode | Who runs the agent loop? | Initial state |
| --- | --- | --- |
| Antigravity | External Antigravity conversation | Paused; adapter remains available for later re-enable |
| Others | Another external coding agent/CLI | Adapter interface only; no provider selected yet |
| RCT | ZETRO on this machine, with a replaceable model API | One-worker pilot implemented; real-task workflow pending |

Codex remains the supervising brain: it decomposes the user's request, chooses task boundaries, reviews results and decides what to do next. ZETRO validates and schedules those assignments; it does not replace Codex's judgment with an autonomous planner. RCT workers receive bounded assignments, edit only approved scopes, and submit evidence. They do not approve their own plan, merge their own work, deploy, or declare themselves verified.

## 2. Provider choice: free is a quota, not five free agents

**First pilot:** Groq API with an A/B comparison of `qwen/qwen3.8-27b` and `openai/gpt-oss-120b`. The published free plan lists each at 30 requests/minute, 1,000 requests/day, 8,000 tokens/minute, and 200,000 tokens/day; both support local tool calling. These are shared organizational limits, not five independent quotas or a guarantee for this account. Check the account's actual limits before dispatch. Groq states that inference data is not retained by default, with limited reliability/abuse exceptions and an optional zero-data-retention control. Code still leaves this machine when included in prompts. [Groq free limits](https://console.groq.com/docs/rate-limits), [Qwen model card](https://console.groq.com/docs/model/qwen/qwen3.8-27b), [GPT-OSS model card](https://console.groq.com/docs/model/openai/gpt-oss-120b), [local tool calling](https://console.groq.com/docs/tool-use/local-tool-calling), [data policy](https://console.groq.com/docs/your-data).

**Fallback candidates, not silently enabled:** Gemini API has free access to selected models and function calling, but its published free-tier pricing says submitted content may be used to improve products. That is a material privacy choice for source code. OpenRouter has free models but its standard free allowance is too small to assume five active coding loops. Provider availability, models and quotas can change, so probe them at setup time. [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling/), [OpenRouter pricing](https://openrouter.ai/pricing/).

Use **one legitimate provider account/key**, never five accounts or keys to evade a quota. Five worker identities share a central rate limiter and token ledger. Start with one worker, increase to two, then five only when reliability and the actual account limits support it. A `429` causes bounded backoff or queueing, never key rotation to circumvent limits. The user supplies a key through a local secret store or environment variable; it is never written into repository files, prompts, receipts, or logs.

## 3. Architecture

```text
Codex decomposition of user request
    -> ZETRO assignment validator
    -> task graph + path ownership + budget reservation
    -> scheduler (up to five logical RCT workers)
    -> per-worker isolated checkout/snapshot
    -> RCT agent loop -> provider API
                      -> restricted local tools
    -> patch + typed receipt + usage metrics
    -> independent tests/diff/policy verifier
    -> human-reviewable result; merge is separate
```

The RCT loop exposes only typed, narrow tools: `list_paths`, `search`, `read_slice`, `propose_patch`, `run_check`, and `submit_receipt`. ZETRO validates every tool argument against the assignment's canonical allowed paths, file-size limits, time limit, and output budget. The model cannot directly invoke arbitrary shell commands or overwrite files outside its isolated workspace. `propose_patch` applies with preimage hashes so stale changes fail rather than overwrite newer work. **Today**, `run_check` evaluates only declared `equals`/`contains` file predicates. A later command-check tool must use fixed executable/argv profiles selected by the coordinator, never shell strings emitted by the model.

The provider adapter translates RCT's typed messages and tool calls into the provider's API format. Provider-specific IDs, retry headers and token usage stay behind that boundary. A provider switch cannot weaken policy or change what `verified` means.

### User-facing mode and tool surface

The initial product surface is a CLI with JSON responses, plus a thin MCP facade so Codex can call the same operations. Mode selection is **per task or session**, never a silent global switch affecting other processes:

```text
zetro mode list
zetro worker list --mode rct
zetro rct probe --provider groq
zetro rct run --assignment <manifest.json> --workers 1
zetro rct status <task-id> --compact
zetro rct evidence <task-id>
zetro rct cancel <task-id>
zetro rct benchmark --fixture <fixture-id> --workers 1,2,5
```

These are **planned commands**, not currently executable. The current pilot exposes `rct:demo`, `rct:probe`, `rct:live-fixture`, and `rct:test` from `products/zetro/package.json`; see [runtime README](../packages/rct-runtime/README.md). `run` will eventually return immediately with a durable task ID; `status` will yield bounded deltas; `evidence` will provide hashes, diff/test summaries and usage. A separate review action will accept or reject a patch. Antigravity and Others must implement the same top-level task/result contract, but their provider-specific commands remain isolated behind adapters.

## 4. Five workers without five-way corruption

Workers `RCT-1` through `RCT-5` are **capacity slots**, not fixed personas. Each assignment declares objective, acceptance criteria, allowed paths, dependencies, max turns, max input/output tokens, deadline, and checks. The scheduler starts only ready, non-conflicting tasks. Tasks touching the same files or shared generated artifacts run sequentially. A worker reports a proposed patch and evidence; the verifier decides acceptance. Failed or ambiguous attempts are not automatically resubmitted.

All five slots are clones of the same tested runtime and can receive different bounded coding assignments. For a suitable task graph, Codex might use RCT-1 and RCT-2 for disjoint implementation slices, RCT-3 for an independent test fixture, RCT-4 for documentation, and RCT-5 for read-only review. Those are assignments, not permanent identities. A small task uses fewer slots; five-way splitting is not a goal by itself.

`E:\Veyminore` is **not currently a Git repository**. Five workers must not write concurrently in that shared directory. Preferred production isolation is Git worktrees after an explicit repository setup decision. Until then, the pilot uses a temporary isolated snapshot for one write worker; other slots may perform read-only analysis, tests, or planning on independent inputs. Parallel write workers are a gated milestone, not a launch promise. No current user files are reset, deleted or silently merged.

## 5. Token, speed and output controls

- Send a compact task envelope, repository map and content-addressed references; fetch only relevant file slices on demand. Do not send full repository trees or full conversation histories on every turn.
- **Target:** reserve per-task and daily token budgets before each API call; track actual provider usage, request count, tool latency, queue time, retry time, and useful verified output. The current pilot caps prompt characters before a call and checks provider-reported tokens afterward, so it can overshoot by one request. Do not equate character count with token count.
- Limit model turns, tool-call depth, output tokens, read bytes and wall-clock time. On a budget breach, return `budget_exhausted` with a checkpoint, not an unbounded continuation.
- Cache unchanged file digests and compact stable instructions where the provider permits. Reuse local search/test results by content hash; invalidate on file changes.
- Prefer a small implementation task with one measurable acceptance test over splitting every request into five tiny tasks. Parallelism is useful only when dependencies and ownership are clean.
- Measure *verified tasks per minute*, *verified changes per 1,000 model tokens*, latency p50/p95, failure/rework rate, and quota utilization. Compare one worker versus two/five on the same fixture before claiming a speedup.

## 6. Execution and trust states

`draft -> validated -> queued -> running -> worker_reported -> verifying -> review_ready | failed | cancelled | unknown`.

Journal task ID, worker ID, provider/model, assignment hash, attempt, workspace/snapshot identity, every tool decision, token usage, patch hash, checks and outcome. API timeout after possible execution is `unknown`; retries require reconciliation and a new attempt ID. A worker's `success` is only a claim. `review_ready` requires independently run checks and a scope-clean diff. Human-only criteria remain marked for human review.

Secrets, credentials, personal data, and unrelated files are excluded from model context. Before any live remote coding task, the user must accept the selected provider's data policy and provide an API key. The default demo uses a small non-sensitive fixture. External publication, deployments, package installs, network calls from tools and destructive filesystem operations are outside the first RCT release.

## 7. Build sequence and exit gates

1. **Contract and mock loop — first slice implemented.** Provider-neutral model/tool/result contract, fake provider, deterministic fixture, usage ledger and metadata journal. An offline worker reaches `review_ready` only after independent checks; denial and failure tests are in place. The budget ledger is usage-based, not a hard preflight token guarantee. Durable task recovery remains to be built.
2. **Groq read-only connection — initial probe passed.** The operator's 2026-10-08 synthetic probe authenticated, confirmed Qwen model availability and returned a `list_paths` tool call (281 input, 14 output tokens). Actual account rate-limit headers and a bounded search/read task remain to verify.
3. **Single coding worker — synthetic trial awaiting final rerun.** Explicit-file temporary snapshot, scoped patch tool, fixed content checks and receipt are implemented. The first operator-run `live-fixture` failed at turn 0 with `fetch failed` after about 10.6 seconds; no patch occurred and the source remained unchanged. The second run reached all four tool calls and wrote `hello world` **without** the required newline (3,888 input + 284 output tokens); independent verification rejected its inaccurate success claim. The third Qwen run repeated the same 11-byte content three times, exhausted its 6,000-input-token budget, and still failed the newline check (6,047 input + 476 output tokens). Exact check criteria and patch-time results did not resolve this model behavior. Repeated no-op edits now stop early. The first GPT-OSS run made the correct 12-byte edit and passed the exact check (1,697 input + 258 output tokens), but a fourth `tool_choice: required` call returned HTTP 400 while requesting a redundant final receipt. The synthetic fixture now lets the independent verifier finalize immediately when all exact checks pass, saving that call. A real small code task, robust crash/429/timeout recovery and independent diff review remain to be built.
4. **Scheduling.** Dependency graph, path leases, global quota limiter and backpressure. Exit: two disjoint tasks finish safely; conflicting tasks serialize; five slots can be configured without assuming five active requests.
5. **Five-worker evaluation.** Benchmark one/two/five on identical tasks and quota. Enable five concurrent writes only after isolation and conflict/merge tests pass, preferably with Git worktrees. If throughput or quality worsens, keep lower concurrency.
6. **Other providers and modes.** Add Gemini/OpenRouter or local inference only behind the same contract and an explicit data-policy choice; later re-enable Antigravity as an optional adapter.

## 8. Decisions needed before private-source execution

1. Confirm that “RCT” means this **in-built local agent runtime using online model inference**; preserve the acronym as given.
2. Confirm whether source snippets may be sent to Groq. If not, choose a local model path instead of a free online API.
3. Decide whether/when to make `E:\Veyminore` a Git repository; until then, five concurrent code writers remain disabled.

The first offline RCT worker, snapshot helper and Groq adapter have been created. The operator successfully made a synthetic live Groq connection probe; no key was stored in the repository. No private-source API call, repository conversion or five-worker scheduler has been created. Antigravity remains paused.

## 9. What “work like Antigravity” means for RCT

The goal is **coding-workflow parity**, not a copy of Antigravity's desktop UI or undocumented internals. An RCT worker should be able to accept a bounded assignment, discover relevant code, make multiple coherent edits, run approved checks, repair a failed check within budget, and return a reviewable result while Codex remains the supervisor. Tool execution, filesystem scope, verification, and evidence are ZETRO's responsibilities; the API model supplies reasoning and tool choices.

| Capability | Pilot now | Required for useful one-worker mode | Later |
| --- | --- | --- | --- |
| Understand task/repo | Objective and explicit file list; read slices | Compact repo map, scoped search, file discovery, dependency hints | Semantic index only if measured useful |
| Modify code | Replace one existing scoped file at a time in a temp copy | Multi-file patch, explicitly authorized new files, diff preview | Deletes/renames under separate policy |
| Run checks | Exact file equality/containment | Fixed test/lint/build profiles with bounded output, timeout and exit code | Project-specific check plugins |
| Repair | Failed check fed back; bounded turns; repeated no-op stop | Distinguish fixable failure from tool/policy failure; keep attempt history | Optional approved repair attempt across sessions |
| Report | Metadata receipt, hashes, usage | Full changed-file inventory, diff, check evidence, remaining uncertainty | UI review and export |
| Persist/recover | JSONL metadata for a single run | Durable task IDs, restart reconciliation, cancellation | Multi-host dispatch |
| Parallel work | None | One reliable write worker | Two disjoint writers, then up to five |

**Non-goals for v1:** autonomous product planning, unrestricted terminal access, unsupervised merge, deployment, publication, or using five API keys to bypass free limits. A convincing agent experience comes from reliable tools and feedback, not from giving a model broad host permissions.

## 10. One-worker vertical slice: exact runtime boundary

The first useful non-synthetic workflow has six stages. Each stage produces a durable event; a crash cannot silently skip to a stronger state.

1. **Admit.** Parse a versioned assignment, resolve the project and source root, validate objective/acceptance, explicit read/write scope, data classification, provider permission, check profiles, deadline, and resource budgets. Show a dry-run summary of exactly which source paths and data classes can leave the machine. Reject ambiguous roots, globs that expand after approval, hidden files, symlink/junction escapes, and missing checks.
2. **Prepare.** Freeze source hashes and create an isolated snapshot of only the approved files. Record source and snapshot identities. The first real task remains one writer; do not edit `E:\Veyminore` in place. Missing dependencies must be declared and copied under read scope, not fetched by the model through the network.
3. **Discover.** Build a small local repo map (paths, package manifests, exported symbols if inexpensive), then send only the task envelope and selected map. Let the worker request bounded search/read slices. Preserve file hashes so repeated reads of unchanged content can be summarized or referenced instead of resent where the provider protocol permits.
4. **Edit.** Apply only hash-checked patches to the snapshot. The next implementation should support bounded multi-file unified diffs or structured edit hunks; full-file replacement is acceptable only for small files. New files need an explicit `createPaths` grant. A patch may change the snapshot, never the original. Detect no-ops and stale preimages before consuming another model turn.
5. **Verify.** Independently inventory every changed and created file, reject out-of-scope changes, run the declared fixed check profiles, and capture bounded stdout/stderr plus exit codes. A model assertion is not a check. Auto-finalization is allowed only when the coordinator explicitly declares machine checks complete; otherwise a worker report leads to `review_ready` with human criteria still open.
6. **Review.** Return a compact status plus on-demand diff, checks, usage, and event timeline. Applying a verified patch to the source is a separate, explicit review operation with a fresh source-hash comparison. If the source changed while the worker ran, return a conflict; never overwrite it.

The current temporary snapshot helper is a pilot, **not** a hostile-process sandbox. Before private-source execution, harden directory permissions, junction handling, race behavior, snapshot retention, and cleanup failure reporting. A snapshot can prevent accidental shared-tree edits; it cannot promise OS-level containment against an independently malicious local process.

### Proposed assignment schema, v1

Keep the manifest small enough for Codex or a human to inspect. Exact field names may change before the schema is frozen, but the semantics must not:

| Field | Purpose | Validation rule |
| --- | --- | --- |
| `schemaVersion`, `taskId`, `projectId` | Identity and migration | Known version; unique task and attempt IDs |
| `objective`, `acceptance[]` | Bounded outcome | Nonempty, measurable or explicitly human-reviewed |
| `source` | Root and base state | Canonical root; source hashes recorded before work |
| `scope.readPaths`, `scope.writePaths`, `scope.createPaths` | Data and edit authority | Resolved exact paths; create separate from overwrite; deny by default |
| `dataPolicy` | What may be sent remotely | Provider/model and classification approved for this task |
| `checks[]` | Independent verification | Fixed predicate or named command profile; no model-authored shell string |
| `budget` | Cost and time ceiling | Max turns, prompt bytes, read/write bytes, input/output token allowance, wall time |
| `dependencies`, `conflicts` | Scheduler ordering | Acyclic graph; no overlapping write leases |
| `reviewPolicy` | Completion authority | Explicit auto-finalization eligibility or human review requirement |

The manifest is immutable after admission. A changed scope, model, check, or budget creates a new attempt and an approval decision; it is not an in-place mutation of a running task.

## 11. Tool protocol and context efficiency

Keep a **small default tool set**. `list_paths` returns a capped path list, `search` returns literal matches/offsets, `read_slice` returns a bounded range plus a file digest, `propose_patch` returns an applied/no-op/stale status plus check results, `run_check` runs only registered profiles, and `submit_receipt` records a claim. Do not offer irrelevant tools on a task: the synthetic fixture already saves schema tokens by exposing only read and patch. No tool accepts an arbitrary shell string, arbitrary URL, or path outside its lease.

For each model turn, record: prompt/tool-schema bytes, actual input/output tokens, latency, local tool latency, retry count, rate-limit headers when present, current file digests, and whether the turn changed verification status. Do not store raw prompts or source in the default journal. The next budget ledger must reserve a conservative estimate before dispatch and reconcile it with provider usage afterward; if exact token counting is unavailable, use a safe character ceiling and label the token ceiling as approximate. Never silently continue after a quota or budget breach.

Use this context order: task/constraints → tiny repo map → only relevant file slices → failing check output → short checkpoint. Trim old successful tool results after their hash and outcome are recorded; keep the latest failed check and its cause. Cache only by content hash and invalidate on edits. Do not compress away policy, scope, or acceptance criteria. A compact status response should be under a configured character cap and point to evidence IDs for full details.

The coordinator may skip a final model call when **all** declared exact checks pass and the assignment opted into verifier auto-finalization. Otherwise the model can submit a report, but it cannot change an independently failed check to pass. Repeated identical unsuccessful patches terminate early. A repair loop has a finite per-attempt count and does not reset token accounting.

## 12. Model routing and benchmark protocol

Provider-neutrality is mandatory; provider-specific request formats, tool IDs, usage, retry headers, and error bodies stay in adapters. HTTP 400 is a model/API failure, not proof that local code failed; 429 is quota pressure; a transport loss after submission yields uncertain remote usage. Retry only safe inference calls within the same deadline, never replay local edits. A quality failure must not trigger an unapproved provider switch that sends source to a new data processor.

**Evidence so far:** Qwen authenticated and called tools, but failed the exact newline fixture twice; the second run repeatedly proposed an unchanged failing patch and used 6,047 input tokens before stopping. GPT-OSS produced the correct 12-byte edit with 1,697 input tokens and passed the exact check, but a redundant forced-tool finalization call returned 400. The current verifier auto-finalization design removes that call; its live rerun is still pending. This is one tiny fixture, not enough to crown a general coding model.

Benchmark candidates on the **same** versioned fixture set, source snapshot, tool contract, limits, and check profiles. Start with: exact-content edit, two-file refactor, failing-unit-test repair, safe new-file creation, read-only code question, prompt-injection-in-source, stale-source conflict, rate-limit response, and transport interruption. Use at least three independent runs per model for nondeterministic tasks. Record first-pass verified completion, attempts to success, input/output tokens per verified result, wall time, 400/429/transport rates, scope violations, and human review burden. Prefer verified results per minute and per 1,000 tokens over raw inference tokens/second. Keep the full failed-attempt denominator; do not compare only successful runs.

Promotion gate for a default model: repeated synthetic success without false `review_ready`, then a small set of approved real coding tasks with independently passing checks and reviewable diffs. If two candidates are close, prefer the one with lower rework, fewer tool-format errors, and better data terms; do not claim universal superiority. Any second provider requires its own data-policy approval and actual quota measurement. A single Groq account/project has shared limits regardless of the number of RCT slots.

## 13. Durability, cancellation, and honest outcomes

The metadata JSONL pilot is not enough for a long-running agent. Introduce a durable task store with transactionally recorded assignment hash, attempt ID, provider/model, snapshot root, source hashes, current turn, budget ledger, tool decision, diff hash, checks, and terminal state. Raw source/diffs belong in restricted artifacts with retention rules, not inline in the task table. On restart, reconcile the last event against the snapshot and tool result; if an external call may have happened without a recorded response, mark remote usage uncertain. If a local patch may have applied, rehash the snapshot before resuming. Never infer completion merely from a worker summary.

Cancellation is best effort for an in-flight API request and immediate for queued work. Stop offering tools after cancellation; leave the snapshot for a short, documented review window unless the operator explicitly discards it. Cleanups target only a validated per-task temporary directory. A failure to clean up is a visible warning with the exact safe path, not a silent success. Do not automatically retry a `failed` or `unknown` coding attempt; require an explicit new attempt tied to the previous receipt.

Separate statuses: `failed_policy`, `failed_tool`, `failed_check`, `failed_provider`, `budget_exhausted`, `cancelled`, `unknown_effect`, and `review_ready` in the next versioned receipt. The current pilot's coarser states remain as-is until a migration is tested. An HTTP error after a verified patch should not erase local check evidence; report both the verified snapshot condition and the provider finalization error, as the first GPT-OSS run demonstrated.

## 14. Isolation and scaling to five slots

Before Git setup, allow **one writer only** and use a private snapshot with an explicit source-hash-based apply step. Read-only work may overlap if it never holds a write lease. Parallel writes to separate temp copies still need a merge/conflict policy, so do not mistake separate folders for safe concurrent application. Do not initialize Git or move the user's files as a side effect of enabling RCT.

If the operator chooses to make the project a Git repository, prefer one worktree per active writer and record base commit, branch, untracked files, dirty state, and worktree lease. A worker never owns the source checkout or applies its own merge. Scheduler ordering is dependency-aware and conflict-aware: overlapping paths, shared generated files, package lockfiles, and project-wide check artifacts count as conflicts. Ready tasks enter a fair queue. The global provider limiter meters all five slots together and adapts concurrency to actual 429s and verified throughput.

Scale in this order: one live writer → two disjoint writers → five configurable slots. A five-slot label is a capacity ceiling, not a promise of five concurrent requests. Benchmark 1/2/5 on a comparable task graph; retain the lower concurrency if five increases latency, cost, conflicts, or rework. Codex should split a task only when slices have independent acceptance checks and path ownership; otherwise one worker is faster and safer.

## 15. Delivery increments and exit tests

| Increment | Build | Exit test |
| --- | --- | --- |
| RCT-0 — close synthetic pilot | Rerun GPT-OSS with verifier auto-finalization; capture compact benchmark receipt | Exact fixture `review_ready`, 12-byte hash match, source unchanged, no redundant final API call; repeat to rule out a fluke |
| RCT-1 — real-task preparation | Versioned assignment schema, dry-run admission, explicit consent/data classification, source snapshot inventory | Deny hidden/junction/out-of-scope/private-without-consent fixtures; original unchanged |
| RCT-2 — one-worker coding | Scoped multi-file edits, named check profiles, changed-file inventory, diff and review receipt | One approved small ZETRO change passes tests in a snapshot; patch applies only after fresh source-hash review |
| RCT-3 — resilient lifecycle | Durable task IDs, cancel, restart reconciliation, typed failure taxonomy, budget reservation | Kill/restart and 400/429/transport fixtures yield honest states; no duplicate local edit or silent quota retry |
| RCT-4 — model evaluation | Same-fixture Qwen/GPT-OSS comparison and optional explicitly approved provider | Default choice supported by verified-task, token and latency evidence; failures retained |
| RCT-5 — two workers | Dependency graph, path leases, central quota/backpressure | Disjoint jobs finish; conflicting jobs serialize; shared-file and crash fixtures pass |
| RCT-6 — five slots | Scale scheduler and review UI/CLI, run 1/2/5 benchmark | Five configurable slots, no cross-workspace writes, measured benefit or documented lower effective concurrency |

At every increment, run unit, integration, security, and end-to-end fixture tests. A green check on a trivial greeting file is necessary for the tool loop, but not sufficient to expose arbitrary repository coding. The user-visible command should advertise its maturity (`synthetic`, `preview`, or `ready`) and refuse an unsupported mode rather than pretending the full platform exists.

## 16. Operator experience and decisions

The proposed operator path is: `rct doctor` (key presence, provider reachability, local isolation support, quotas) → `rct plan --assignment ...` (scope/consent/cost preview) → `rct run` (durable ID) → `rct status --compact` → `rct evidence` (diff/checks/cost) → `rct review apply|reject`. A dry run makes no model call. `review apply` compares current source hashes to the admitted base and requires a human-authorized exact target. No deployment or publication command belongs in the first RCT release.

Three owner choices govern the first private-source task: (1) whether ZETRO source snippets may be sent to Groq, (2) which small real task and paths are in scope, and (3) whether to remain snapshot-only or initialize Git before broader multi-file work. None is inferred from a successful synthetic probe. If remote source sharing is declined, the same runtime can later use a local model provider, but its quality and hardware requirements need a separate evaluation.
