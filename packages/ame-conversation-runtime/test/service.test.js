import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationService, InMemoryConversationStore } from '../src/service.js';
import { GroqStreamingProvider } from '../src/groq-provider.js';
import { PostgresConversationStore } from '../src/postgres-store.js';

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

class FakePostgresPool {
  rows = new Map();

  async query(sql, values = []) {
    if (sql.startsWith('SELECT')) {
      const row = this.rows.get(values[0]);
      return { rows: row ? [structuredClone(row)] : [] };
    }
    if (sql.startsWith('INSERT')) {
      const [conversationId, principalId, rawMessages] = values;
      if (this.rows.has(conversationId)) throw new Error('duplicate key');
      const now = new Date().toISOString();
      const row = {
        conversation_id: conversationId,
        principal_id: principalId,
        messages: JSON.parse(rawMessages),
        version: 0,
        created_at: now,
        updated_at: now
      };
      this.rows.set(conversationId, row);
      return { rows: [structuredClone(row)] };
    }
    if (sql.startsWith('UPDATE')) {
      const [rawMessages, conversationId, principalId, expectedVersion] = values;
      const row = this.rows.get(conversationId);
      if (!row || row.principal_id !== principalId || row.version !== expectedVersion) return { rows: [] };
      row.messages = JSON.parse(rawMessages);
      row.version += 1;
      row.updated_at = new Date().toISOString();
      return { rows: [structuredClone(row)] };
    }
    throw new Error('Unexpected SQL in fake pool');
  }
}

test('PostgreSQL store persists messages and rejects stale concurrent writes', async () => {
  const pool = new FakePostgresPool();
  const firstStore = new PostgresConversationStore({ pool });
  const secondStore = new PostgresConversationStore({ pool });
  await firstStore.create({ conversationId: 'durable-1', principalId: 'device-1' });

  const first = await firstStore.get('durable-1');
  const stale = await secondStore.get('durable-1');
  first.messages.push({ role: 'user', content: 'first', turnId: 't1' });
  const saved = await firstStore.save(first);

  assert.equal(saved.version, 1);
  assert.equal(saved.messages.length, 1);
  stale.messages.push({ role: 'user', content: 'stale', turnId: 't2' });
  await assert.rejects(secondStore.save(stale), /version conflict/);

  const reloaded = await secondStore.get('durable-1');
  assert.equal(reloaded.version, 1);
  assert.equal(reloaded.messages[0].content, 'first');
});

test('in-memory store also rejects stale snapshots', async () => {
  const store = new InMemoryConversationStore();
  await store.create({ conversationId: 'memory-1', principalId: 'device-1' });
  const first = await store.get('memory-1');
  const stale = await store.get('memory-1');
  first.messages.push({ role: 'user', content: 'first', turnId: 't1' });
  await store.save(first);
  stale.messages.push({ role: 'user', content: 'stale', turnId: 't2' });
  await assert.rejects(store.save(stale), /version conflict/);
});
