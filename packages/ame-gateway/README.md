# AME WebSocket gateway adapter v0

A chat-only AME v0.1 gateway adapter for a TLS WebSocket server. It connects the Android protocol client to the ZETRO conversation runtime.

## Host integration

This package deliberately does not create an HTTP server, terminate TLS, store device tokens, or bundle a WebSocket implementation. The host supplies a ws-compatible WebSocketServer and a device-token authenticator:

```js
import { WebSocketServer } from 'ws';
import { attachAmeGateway } from '@veyminore/zetro-ame-gateway';

const webSocketServer = new WebSocketServer({
  noServer: true,
  maxPayload: 64 * 1024
});

const gateway = attachAmeGateway({
  webSocketServer,
  runtime,
  authenticate: async ({ authorization }) => {
    // Verify signature/secret, expiry, revocation and device binding.
    // Return the device ID bound to this credential; never log the token.
    return deviceTokenService.authenticate(authorization);
  },
  onError: ({ error, phase, sessionId, turnId }) => {
    // Send redacted operational telemetry. Do not log authorization headers or prompt bodies.
  }
});

// The host must attach the WSS to an HTTPS server and route only the intended
// /ame upgrade path to webSocketServer.handleUpgrade(...).
// On graceful shutdown:
gateway.close();
```

When TLS terminates at a trusted reverse proxy, explicitly provide an isSecureRequest implementation that trusts only the proxy connection and its authenticated forwarding metadata. Do not trust arbitrary client-supplied forwarded headers.

## Protocol behavior

- Requires TLS and an Authorization: Bearer header.
- Calls the injected authenticator and binds conversations to its returned deviceId.
- Requires the session.open event as the first event with sequence 0 and a matching payload deviceId.
- Returns session.accepted with a canonical conversationId and serverTime.
- Accepts strictly increasing inbound sequence numbers, unique event IDs and bounded text events.
- Streams assistant.delta events and one assistant.complete event from ConversationService.
- Supports session.close and user.turn only after session.open; cancels responses after 80 seconds, below the Android client's 90-second response timeout.
- Rejects capability execution/approval events in this alpha. No device actions are performed by this gateway.

## Production boundaries

The host must configure TLS, WebSocket maxPayload <= 64 KiB, authentication, revocation, edge rate limits, connection limits, database credentials and graceful shutdown. Use PostgresConversationStore for durable history; InMemoryConversationStore is only for tests/local development. Add database retention/deletion, backups, access auditing and encryption controls before production.

The adapter buffers at most 256 KiB of queued inbound frames per connection and rejects duplicate/out-of-order events. This is not a replacement for network-level rate limiting or per-device quotas. Provider API keys remain in the ZETRO server environment. The Android app never receives provider credentials.
