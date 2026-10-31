# AME gateway v0 — integration status

## Current state

The following components have implementation branches and passing GitHub Actions checks as of 31 October 2026:

| Component | Repository location | Status |
| --- | --- | --- |
| AME protocol v0.1 | packages/ame-protocol | Implemented; PR #2 |
| Android AME ZETRO client | Z-A-R-R-O/ame-upstream | Implemented; Android PR #1 merged; Kotlin compatibility fix PR #4 passes CI |
| Conversation runtime | packages/ame-conversation-runtime | Implemented; PR #3 |
| PostgreSQL conversation store | packages/ame-conversation-runtime | Implemented; PR #4 |
| WebSocket gateway adapter | packages/ame-gateway | Implemented; PR #5 |

These are review branches, not a deployed service. The gateway package is an adapter that attaches to a host-provided WebSocketServer; it does not itself create a TLS listener, issue device tokens, provision a database, or deploy an endpoint.

## Data flow

1. Android opens an outbound WSS connection and sends session.open with sequence 0.
2. The host authenticates the Authorization bearer token out-of-band and returns the credential-bound device ID.
3. The gateway verifies the payload device ID matches the authenticated device, creates or resumes a device-bound conversation, and replies with session.accepted.
4. Android sends user.turn with the next sequence.
5. The gateway calls ConversationService, which persists the user turn, streams provider output, and persists the completed assistant message.
6. The gateway forwards assistant.delta and assistant.complete events using an independent server sequence.
7. Android renders the result and performs TTS locally.

## Host requirements before device connection

- A Node.js 20+ long-running service with a TLS-only WebSocket listener.
- A WebSocketServer configured with maxPayload <= 64 KiB and an HTTPS upgrade route restricted to the AME path.
- A real device-token issuer/authenticator with expiry and revocation. The gateway deliberately accepts an injected authenticate() implementation; a production token registry/issuer is still a separate task.
- PostgreSQL with migrations/001_create_ame_conversations.sql applied, DATABASE_URL, backups, access controls, retention and deletion policy.
- A server-side provider secret such as GROQ_API_KEY and a configured supported model. Never put provider credentials in the Android app.
- Network-level rate limits, per-device connection limits, deployment health checks and graceful shutdown.
- A public WSS URL and a paired bearer token entered into the AME backend settings.

The adapter’s default secure-request check requires request.socket.encrypted. When TLS is terminated at a reverse proxy, only override isSecureRequest after configuring a trusted proxy path and validating its forwarding metadata; never trust arbitrary client-supplied forwarded headers.

## Alpha restrictions

- Only session.open, user.turn and session.close are accepted from the client.
- Capability execution, approvals and remote device actions are intentionally disabled.
- No always-on microphone or wake-word behavior is implied by this backend integration.
- The Android client stores conversation resume mapping in memory; process restarts require opening a new local chat-to-conversation mapping unless the app persists that mapping in a future change.
- Conversation persistence is device-bound using the authenticated device ID as principalId.

## Review and merge order

The implementation is intentionally stacked to make dependencies explicit:

1. ZETRO PR #2 — protocol contract.
2. ZETRO PR #3 — conversation runtime.
3. ZETRO PR #4 — PostgreSQL conversation persistence (based on PR #3).
4. ZETRO PR #5 — gateway adapter (based on PR #4; includes the shared protocol package for a self-contained branch).
5. AME Android PR #4 — exhaustive AME_ZETRO type handling; PR #1 integration is already merged.

Do not merge the stacked PRs out of order. Re-run PR checks after each base branch advances. These checks validate code/tests only; they do not prove a live deployment or a real Android-to-server conversation.
