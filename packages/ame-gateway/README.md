# AME WebSocket gateway v0

A chat-only AME v0.1 gateway adapter for a TLS WebSocket server. It connects the Android protocol client to the ZETRO conversation runtime.

## Host integration

The package exports the WebSocket adapter and PostgreSQL device-token service. The host supplies Node.js, the `ws` and `pg` packages, TLS certificate files, and a PostgreSQL database with both migrations applied.

Example HTTPS host (illustrative; adapt certificate paths and process supervision to the deployment):

```js
import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import pg from 'pg';
import { WebSocketServer } from 'ws';
import {
  attachAmeGateway,
  PostgresDeviceTokenService
} from '@veyminore/zetro-ame-gateway';
import {
  ConversationService,
  GroqStreamingProvider,
  PostgresConversationStore
} from '@veyminore/ame-conversation-runtime';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const runtime = new ConversationService({
  provider: new GroqStreamingProvider({
    apiKey: process.env.GROQ_API_KEY,
    model: process.env.GROQ_MODEL
  }),
  store: new PostgresConversationStore({ pool })
});
const deviceTokens = new PostgresDeviceTokenService({ pool });

const httpsServer = createServer({
  key: readFileSync(process.env.TLS_KEY_FILE),
  cert: readFileSync(process.env.TLS_CERT_FILE)
});
const webSocketServer = new WebSocketServer({
  noServer: true,
  maxPayload: 64 * 1024
});

const gateway = attachAmeGateway({
  webSocketServer,
  runtime,
  authenticate: ({ authorization }) => deviceTokens.authenticate({ authorization }),
  onError: ({ error, phase, sessionId, turnId }) => {
    // Send redacted operational telemetry. Never log authorization headers or prompts.
  }
});

httpsServer.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url ?? '/', 'https://localhost').pathname;
  if (pathname !== '/ame') {
    socket.destroy();
    return;
  }
  webSocketServer.handleUpgrade(request, socket, head, ws => {
    webSocketServer.emit('connection', ws, request);
  });
});

httpsServer.listen(Number(process.env.PORT ?? 8443));

// On graceful shutdown, stop accepting connections, close the gateway and WSS,
// close the HTTPS listener, then await pool.end().
```

Provision a device token out-of-band through a secured operator workflow. For example, call `deviceTokens.issue({ deviceId, label })` once, deliver the returned raw token to the intended Android device over a secure channel, and never log or persist the plaintext token. The raw token is returned only once. Revoke it with `deviceTokens.revoke({ tokenId })`. Do not issue new tokens on every server restart.

When TLS terminates at a trusted reverse proxy, explicitly provide an `isSecureRequest` implementation that trusts only the proxy connection and authenticated forwarding metadata. Do not trust arbitrary client-supplied forwarded headers.

## Database migrations

Apply both files in order:

1. `../ame-conversation-runtime/migrations/001_create_ame_conversations.sql`
2. `002_device_tokens.sql`

The conversation store persists message content as JSONB. The token service stores only SHA-256 hashes of random 256-bit bearer tokens. Token validity is checked atomically against expiry and revocation in PostgreSQL. Default expiry is 90 days; the maximum configurable lifetime is 365 days.

## Protocol behavior

- Requires TLS and an Authorization: Bearer header.
- Authenticates the bearer token and binds conversations to its deviceId.
- Requires `session.open` as the first event with sequence 0 and a matching payload deviceId.
- Returns `session.accepted` with a canonical conversationId and serverTime.
- Accepts strictly increasing inbound sequence numbers, unique event IDs and bounded text events.
- Streams `assistant.delta` and one `assistant.complete` event from ConversationService.
- Supports `session.close` and `user.turn` only after `session.open`; responses time out after 80 seconds, below the Android client's 90-second timeout.
- Rejects capability execution/approval events in this alpha. No device actions are performed by this gateway.

## Production boundaries

The host must configure TLS, WebSocket maxPayload <= 64 KiB, token provisioning and revocation, edge rate limits, connection limits, database credentials, backups, retention/deletion policy, access auditing, health checks and graceful shutdown. The adapter buffers at most 256 KiB of queued inbound frames per connection and rejects duplicate/out-of-order events; this does not replace network-level rate limiting or per-device quotas.

Provider API keys remain in the ZETRO server environment. The Android app receives only a revocable device bearer token and never receives provider credentials. Capability execution remains disabled until a separate authorization, approval and local Android execution boundary is implemented.
