# Antigravity Adapter

ZETRO's adapter for securely observing and communicating with local Antigravity agents.

## Requirements
- **Node.js >= 22.5.0** is required for full observation capabilities. The observation API relies on the built-in `node:sqlite` module to read diagnostic fallbacks.
- On unsupported Node.js runtimes, the agent state will safely fall back to `unknown`.

## CLI Usage
The CLI provides several commands to interact with configured agents (AGR-1 through AGR-5).

- `zetro-ag status [--json]`
  Outputs the observation status of all configured agents. Use `--json` for programmatic integration (e.g., by AGR-5).
- `zetro-ag observe <AGENT> [--json]`
  Outputs the status of a specific agent.

## Diagnostics & Limitations
The observation API uses supported endpoints (`agentapi get-conversation-metadata`) for identity verification. To determine `idle/running` states and step counts, the adapter uses a read-only SQLite diagnostic fallback that queries local `.db` files directly.

**Important:** An `idle` state merely indicates that the agent is not currently actively executing a step. It does **not** signify task completion, success, or semantic verification.
