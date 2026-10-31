import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationService, InMemoryConversationStore } from '../src/service.js';
import { GroqStreamingProvider } from '../src/groq-provider.js';

function serviceWith(chunks = ['Hello', ' there']) {
  const provider = { async *stream() { for (const chunk of chunks) yield chunk; } };
  const store = new InMemoryConversationStore();
  return { service: new ConversationService({ provider, store }), store };
}

test('opens and resumes a conversation for the same principal', async () => {
  const { service } = serviceWith();
  assert.deepEqual(await service.open({ conversationId: 'c1', principalId: 'device1' }), { conversationId: 'c1', resumed: false });
  assert.deepEqual(await service.open({ conversationId: 'c1', principalId: 'device1' }), { conversationId: 'c1', resumed: true });
});

test('does not allow another principal to resume a conversation', async () => {
  const { service } = serviceWith();
  await service.open({ conversationId: 'c1', principalId: 'device1' });
  await assert.rejects(service.open({ conversationId: 'c1', principalId: 'device2' }), /principal mismatch/);
});

test('streams deltas and persists the completed assistant turn', async () => {
  const { service, store } = serviceWith();
  await service.open({ conversationId: 'c1', principalId: 'device1' });
  const events = [];
  for await (const event of service.turn({ conversationId: 'c1', principalId: 'device1', turnId: 't1', text: 'Hi' })) events.push(event);
  assert.deepEqual(events.map(event => event.type), ['assistant.started', 'assistant.delta', 'assistant.delta', 'assistant.complete']);
  const saved = await store.get('c1');
  assert.deepEqual(saved.messages.map(message => message.role), ['user', 'assistant']);
  assert.equal(saved.messages[1].content, 'Hello there');
});

test('rejects duplicate turn IDs and concurrent turns', async () => {
  let release;
  const provider = { async *stream() { await new Promise(resolve => { release = resolve; }); yield 'done'; } };
  const service = new ConversationService({ provider, store: new InMemoryConversationStore() });
  await service.open({ conversationId: 'c1', principalId: 'device1' });
  const iterator = service.turn({ conversationId: 'c1', principalId: 'device1', turnId: 't1', text: 'Hi' });
  await iterator.next();
  await assert.rejects(service.turn({ conversationId: 'c1', principalId: 'device1', turnId: 't2', text: 'Again' }).next(), /already active/);
  const pending = iterator.next();
  await new Promise(resolve => setImmediate(resolve));
  release();
  await pending;
  for await (const _ of iterator) { /* drain */ }
  await assert.rejects(async () => { for await (const _ of service.turn({ conversationId: 'c1', principalId: 'device1', turnId: 't1', text: 'Hi again' })) {} }, /Duplicate turnId/);
});

test('requires HTTPS and a provider token', () => {
  assert.throws(() => new GroqStreamingProvider({ apiKey: 'x', endpoint: 'http://localhost:1234' }), /HTTPS/);
  assert.throws(() => new GroqStreamingProvider({ apiKey: '' }), /GROQ_API_KEY/);
});
