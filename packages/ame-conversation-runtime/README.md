# AME conversation runtime v0

Provider-neutral conversation service for the AME ↔ ZETRO integration.

## Scope

- Principal-bound conversation open/resume.
- A streaming provider port with assistant delta/completion events.
- Bounded message and history sizes.
- Per-conversation turn serialization and duplicate turn ID rejection.
- Groq-compatible HTTPS streaming provider.

## Important limits

- The included store is in-memory and loses conversations when the process exits. Replace it with a durable transactional store before production gateway deployment.
- This package is a conversation engine, not a network gateway. It does not expose WebSocket/HTTP endpoints or authenticate bearer tokens.
- Android capability events are outside this runtime. Device actions must be authorized and executed by the Android app's local capability boundary, never by this chat service.
- Provider credentials must be supplied through the server environment and must never be sent to AME.

## Minimal usage

```js
import { ConversationService, InMemoryConversationStore, GroqStreamingProvider } from '@veyminore/ame-conversation-runtime';

const runtime = new ConversationService({
  provider: new GroqStreamingProvider({ model: 'openai/gpt-oss-120b' }),
  store: new InMemoryConversationStore()
});
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

Run tests with `pnpm --filter @veyminore/ame-conversation-runtime test`.
