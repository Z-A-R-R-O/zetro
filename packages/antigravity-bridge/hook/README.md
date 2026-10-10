# Antigravity Bridge - Stop Hook

Isolated Antigravity 2.0 Stop-hook handler. Parses stdin JSON for `conversationId`, `fullyIdle` (boolean), `terminationReason`, and `executionNum` (integer).
Filters events exclusively for configured AGR-1 (failing closed if `agents.json` is unreadable), and appends a conversation-scoped lifecycle event to `$ZETRO_DATA_DIR/journal.jsonl`.

## Data Storage Default
If the `ZETRO_DATA_DIR` environment variable is **unset** (as in the default live command hook), the event journal safely defaults to:
`%LOCALAPPDATA%\Zetro\bridge\journal.jsonl`

## Task Correlation
`taskId` remains strictly `null`. A coordinator cannot know `executionNum` before sending, making prepopulation unreliable. Thus, the Stop hook logs the conversation-scoped event unconditionally without fabricating or guessing task IDs. Downstream systems can tentatively associate events, but only a task-bearing worker receipt establishes true correlation.
**Note:** An `idle/stop` captured event is **never** verified completion—it is execution loop termination only.

## Runbook: Installation Validator
To preview hook installation without modifying the live workspace:
```powershell
node install-dryrun.js
```
This script validates `.agents/hooks.json` in the workspace root against the named map schema (`zetro-bridge`), reporting exact insertion plans, correct paths, and potential conflicts. It writes no live config.

## Runbook: Testing on Windows
Run synthetic fixture tests locally (uses temporary data dir, preserves preexisting data):
```powershell
node stop.test.js
```

Test manually via pipeline:
```powershell
$env:ZETRO_DATA_DIR="C:\temp\zetro_data"
echo '{"conversationId":"f4881509-063a-4690-b5c4-985fd16cb39f","fullyIdle":true,"executionNum":1}' | node stop.js
```
*(Expected output: `{"decision":"allow"}`)*

## Live Signal of Viability
Once integrated, viability is proven by:
1. Agent action completes or hits a boundary (execution loop termination).
2. An append event correlates in `%LOCALAPPDATA%\Zetro\bridge\journal.jsonl` (or your override dir) for AGR-1 with `taskId: null`.
