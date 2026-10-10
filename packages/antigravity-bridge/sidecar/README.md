# Antigravity Managed Sidecar Wrapper

Persistent background sidecar process utilizing `@veyminore/zetro-antigravity` to dispatch single-submission tasks from a local filesystem inbox with guaranteed at-most-once delivery semantics.

## Installation Procedure (Template Only)
The included `sidecar.json` serves strictly as a configuration template and is not currently installed. Antigravity only discovers sidecar configurations placed within the global or plugin `sidecars/` directories.
To explicitly install:
1. Copy `sidecar.json` to the target Antigravity sidecar discovery directory (e.g., `~/.gemini/config/sidecars/`).
2. Update the `args` array to point to the absolute filepath of `src/main.js` on the system.
*Note: Do not mutate global configs directly until explicitly directed.*

## Data Directory
In a managed Antigravity environment, the sidecar utilizes the persistent directory provided natively via the `ANTIGRAVITY_EXECUTABLE_DATA_DIR` environment variable. For local standalone testing, it safely falls back to a `.data/` directory relative to this workspace.

## Configuration & Schema
The `sidecar.json` file uses the minimal documented schema (`command`, `args`, `restart_policy`, `description`).

## Crash Recovery & Stale Locks
The inbox listener enforces a strict single-process lock using `.data/sidecar.lock`. A fatal error will be thrown if a duplicate instance is booted.

If the sidecar crashes ungracefully, `.data/sidecar.lock` **remains intact** as evidence. This prevents silent concurrent spins and false permanent locks.
**Reconciliation Procedure**:
1. Inspect the crashing PID's system logs to understand the failure.
2. Explicitly remove `.data/sidecar.lock` to clear the lock.
3. Restart the sidecar.

## File Inbox Task Queue & At-Most-Once Reconciliation
The sidecar polls `.data/inbox/`. Dispatch tasks by dropping empty files named `<taskId>.task`.
Tasks are mapped strictly to an append-only `.data/journal.log` ensuring at-most-once delivery:
1. **Intent Logged**: `taskId:ATTEMPT_INTENT` is written and fsync'd *before* calling the adapter.
2. **Successful Sent**: `taskId:SUBMITTED` is appended, `.task` file is safely deleted. Note: Returns `submitted` only if the adapter confirms strict `delivery === 'submitted'`.
3. **Failed**: `taskId:FAILED` is appended, `.task` file is *retained* intact. 
4. **Crash Window Recovery**: If restarted, any `ATTEMPT_INTENT` lacking an ack is permanently marked `UNKNOWN`. The `.task` file is preserved, preventing unsafe auto-resubmission.

## Discovery Fallback Observations
The adapter assumes `ANTIGRAVITY_LS_ADDRESS` and `ANTIGRAVITY_CSRF_TOKEN` are present. This is an observed adapter detail, not an explicitly guaranteed API promise.
