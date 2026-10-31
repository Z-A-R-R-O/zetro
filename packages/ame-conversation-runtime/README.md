# AME conversation runtime v0

Provider-neutral conversation service for the AME ↔ ZETRO integration.

## Scope

- Principal-bound conversation open/resume.
- A streaming provider port with assistant delta/completion events.
- Bounded message and history sizes.
- Per-process turn serialization and optimistic version checks for cross-process write conflicts.
- Groq-compatible HTTPS streaming provider.
- In-memory store for tests and local development.
- PostgreSQL store for durable conversation history.

## Durable storage

The PostgreSQL adapter accepts any pool exposing the pg-compatible query(sql, values) method. The runtime package does not bundle a database driver.

Apply migrations/001_create_ame_conversations.sql to the target database, then configure the runtime with a PostgreSQL pool:

```js
import { Pool } from 'pg';
import {
  ConversationService,
  GroqStreamingProvider,
  PostgresConversationStore
} from '@veyminore/ame-conversation-runtime';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const runtime = new ConversationService({
  provider: new GroqStreamingProvider(),
  store: new PostgresConversationStore({ pool })
});
```

The store uses parameterized SQL, principal-bound reads/writes, and a monotonically increasing row version. Updates use compare-and-swap semantics, so two server instances cannot silently overwrite each other's conversation snapshots. A version conflict must be handled by the transport/session layer by reloading and deciding whether to retry; the store deliberately does not retry blindly.

## Important limits

- This package is a conversation engine, not a network gateway. It does not expose WebSocket/HTTP endpoints or authenticate bearer tokens.
- The PostgreSQL adapter persists message content in the database. Production deployment must apply least-privilege database credentials, encrypted transport, appropriate at-rest encryption, backups, retention/deletion policy, and access auditing.
- The in-memory store loses conversations when the process exits; use it only for tests or local development.
- Provider credentials must be supplied through the server environment and must never be sent to AME.
- Android capability events are outside this runtime. Device actions must be authorized and executed by the Android app's local capability boundary, never by this chat service.

## Usage with a store

Both stores implement the same get/create/save contract. Open a conversation using an authenticated principal identifier, then stream turns:

```js
await runtime.open({ conversationId: 'opaque-id', principalId: 'authenticated-device-id' });
for await (const event of runtime.turn({
  conversationId: 'opaque-id',
  principalId: 'authenticated-device-id',
  turnId: 'turn-1',
  text: 'Hello'
})) {
  // Forward assistant.started / assistant.delta / assistant.complete to the authenticated transport.
}
```

Run tests with pnpm --filter @veyminore/ame-conversation-runtime test.
