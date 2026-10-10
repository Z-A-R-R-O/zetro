# Agent Tools

Agent-facing local tool surface around the `@veyminore/zetro-antigravity` adapter.

## Commands
* `node src/cli.js verify-all [--max-chars <num>]`
* `node src/cli.js inspect <agrId> [--max-chars <num>]`
* `node src/cli.js send <agrId> <message> [--dry-run] [--max-chars <num>]`
* `node src/cli.js send-packed <AGR> --input <task.json> --store <dir> --budget <num> [--dry-run] [--max-chars <num>]`
* `node src/cli.js poll <agrId> [--max-chars <num>]`
* `node src/cli.js status-all [--max-chars <num>]`
* `node src/cli.js status-compact [--max-chars <num>]`

## Configuration
* `--max-chars <num>`: Limit maximum JSON character output. Must be an integer `>= 128` (default: 5000).
* `--dry-run`: Validates processing and schema without triggering adapter fetch execution.

Outputs are stable JSON payloads containing a `requestId`. Bounded errors and character limits are configurable.

## Limitations & Diagnostics
Diagnostic statuses and verbose logs are intentionally truncated or limited to securely obey budget bounds. Full raw diagnostics/stack traces are only kept locally inside evidence logs or adapter outputs. Furthermore, sensitive keys like `token` and `prompt` are automatically redacted from CLI payload returns to prevent context leakage.

## Tests
`npm test`
