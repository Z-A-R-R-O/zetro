# RCT runtime — first executable slice

This package is ZETRO's provider-neutral **single-worker pilot**. It does not use Antigravity. The only runnable coding demo uses a generated, non-sensitive temporary fixture and a deterministic fake provider. It does not alter `E:\Veyminore` source files.

```powershell
cd E:\Veyminore\products\zetro\packages\rct-runtime
npm test
npm run demo
node src/cli.js probe
node src/cli.js live-fixture
```

`probe` reports `not_configured` without making a network call when `GROQ_API_KEY` is absent. If the key is set in the current process environment, it first checks authenticated model access, then makes one small synthetic tool-call request to Groq. The output names the failing stage; the key is never printed. The two pilot model IDs are `qwen/qwen3.8-27b` and `openai/gpt-oss-120b`. The live probe may consume the account's API quota. The provider implementation follows [Groq's API reference](https://console.groq.com/docs/api-reference) and [local tool calling format](https://console.groq.com/docs/tool-use/local-tool-calling).

`live-fixture` is the first end-to-end live coding trial. It generates a tiny public greeting file, copies that file into a private temporary snapshot, sends only this synthetic task and file content to Groq, and checks that the original stayed unchanged. It deletes both temporary directories after printing a metadata-only receipt. It never reads or sends private Veyminore files. It may consume several API requests and tokens. Pass `openai/gpt-oss-120b` as the optional model argument for the comparison run.

The Groq adapter makes at most one bounded retry for a transport-only inference failure, before any local tool call is executed. If both attempts fail, the result is `unknown` with `remoteUsageUncertain: true`: Groq may still have counted a request even though no response reached ZETRO. HTTP errors such as 401, 400 and 429 are not retried automatically.

## Current contract

`runAssignment(assignment, provider, isolatedRoot, { isolated: true, journalPath? })` accepts explicit allowed files and deterministic `equals`/`contains` checks. A provider returns exactly one typed tool call and measured token usage per turn. The runtime only exposes `list_paths`, `search`, `read_slice`, `propose_patch`, `run_check`, and `submit_receipt`. Replacements require the current file's SHA-256 hash. Checks run after each patch; a worker receipt is refused until they pass, giving the worker a bounded chance to repair a mistake. The final `review_ready` state requires at least one actual patch and all independent checks passing, plus either a worker receipt or explicit verifier auto-finalization. It is **not** an automatic merge or deployment.

For assignments whose acceptance is fully expressed by exact equality checks, the coordinator may opt into `autoFinalizeOnChecks: true`. Then the independent verifier generates the review-ready receipt as soon as a patch passes all checks, without spending a model call on a final claim. The receipt marks `completionSource: independent_checks`. This is enabled only for the synthetic live fixture, not automatically for arbitrary tasks.

Identical replacement content is a no-op and does not count as an applied patch. Two consecutive no-op proposals while checks still fail end the attempt with `failureReason: repeated_noop`, avoiding more token spend on an unchanged result.

The worker receives a minimal task envelope and pulls file slices on demand. The coordinator can expose only the subset of tools a task needs; the synthetic live fixture offers just `read_slice` and `propose_patch` to reduce repeated schema tokens. Read/write byte caps, prompt size, provider-reported token totals, maximum turns and wall time bound the pilot. Input-token limits are checked against provider usage **after each request**; they are not a guaranteed preflight ceiling because no provider tokenizer is bundled. API usage is therefore still possible before an over-budget response is detected. The journal records metadata and hashes, not file contents or credentials.

## Deliberate limits

- `createSnapshot` now copies only explicitly listed regular files into a private temporary directory and records source hashes. Callers of `runAssignment` must still supply a private snapshot; `isolated: true` is a declaration, not proof. Do not pass the shared Veyminore directory as `isolatedRoot`.
- The pilot edits existing, explicitly listed regular files only. Hidden paths, symlinks, path traversal and arbitrary shell commands are unavailable.
- The current filesystem guard assumes no hostile concurrent process is mutating the private snapshot. Full race-resistant filesystem isolation is still future work.
- Only a **synthetic** live coding run is exposed by the CLI. Private-source live coding, five-worker scheduling, durable recovery and multi-provider benchmarking are not ready.
- Groq's free-tier quotas are account-wide and may change. Five configured slots would not mean five independent free quotas.
