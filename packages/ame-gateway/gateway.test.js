import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createAmeEvent } from '@veyminore/zetro-ame-protocol';
import { attachAmeGateway } from './index.js';

class FakeWebSocketServer extends EventEmitter {}

class FakeSocket extends EventEmitter {
  readyState = 1;
  sent = [];
  closeCode = null;
  closeReason = null;

  send(raw, callback) {
    this.sent.push(JSON.parse(raw));
    callback?.();
  }

  close(code, reason) {
    if (this.readyState === 3) return;
    this.closeCode = code;
    this.closeReason = reason;
    this.readyState = 3;
    this.emit('close', code, Buffer.from(reason));
  }

  receive(event) {
    this.emit('message', Buffer.from(JSON.stringify(event)), false);
  }
}

function makeEvent({ sessionId = 'session-1', sequence, type, payload, turnId = null, eventId = `event-${sequence}` }) {
  return createAmeEvent({ sessionId, sequence, type, payload, turnId, eventId });
}

async function waitFor(predicate) {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('Timed out waiting for gateway event');
}

function connect({ runtime, authenticate = async () => ({ deviceId: 'device-1' }), secure = true } = {}) {
  const webSocketServer = new FakeWebSocketServer();
  const socket = new FakeSocket();
  const errors = [];
  const gateway = attachAmeGateway({
    webSocketServer,
    authenticate,
    runtime: runtime ?? {
      async open() {},
      async *turn() {
        yield { type: 'assistant.delta', text: 'Hello' };
        yield { type: 'assistant.complete', text: 'Hello' };
      }
    },
    onError: event => errors.push(event)
  });
  webSocketServer.emit('connection', socket, {
    headers: { authorization: 'Bearer valid-device-token' },
    socket: { encrypted: secure }
  });
  return { webSocketServer, socket, gateway, errors };
}

function openEvent(deviceId = 'device-1') {
  return makeEvent({
    sequence: 0,
    type: 'session.open',
    payload: { deviceId, appVersion: '0.1.0', deviceCapabilities: [] }
  });
}

test('authenticates device and accepts an AME v0.1 session', async () => {
  let authenticatedHeader;
  let opened;
  const { socket } = connect({
    authenticate: async ({ authorization }) => {
      authenticatedHeader = authorization;
      return { deviceId: 'device-1' };
    },
    runtime: {
      async open(input) { opened = input; },
      async *turn() {}
    }
  });

  socket.receive(openEvent());
  await waitFor(() => socket.sent.length === 1);
  assert.equal(authenticatedHeader, 'Bearer valid-device-token');
  assert.equal(socket.sent[0].type, 'session.accepted');
  assert.equal(socket.sent[0].sequence, 0);
  assert.equal(socket.sent[0].payload.conversationId, opened.conversationId);
  assert.equal(opened.principalId, 'device-1');
  assert.ok(Date.parse(socket.sent[0].payload.serverTime));
});

test('streams assistant deltas and completion using increasing server sequences', async () => {
  let turnInput;
  const { socket } = connect({
    runtime: {
      async open() {},
      async *turn(input) {
        turnInput = input;
        yield { type: 'assistant.started' };
        yield { type: 'assistant.delta', text: 'Hello' };
        yield { type: 'assistant.complete', text: 'Hello' };
      }
    }
  });

  socket.receive(openEvent());
  await waitFor(() => socket.sent.length === 1);
  socket.receive(makeEvent({
    sequence: 1,
    type: 'user.turn',
    turnId: 'turn-1',
    payload: { text: 'Hi', source: 'typed', locale: 'en-IN' }
  }));
  await waitFor(() => socket.sent.length === 3);

  assert.equal(turnInput.principalId, 'device-1');
  assert.equal(turnInput.conversationId, socket.sent[0].payload.conversationId);
  assert.equal(turnInput.turnId, 'turn-1');
  assert.deepEqual(socket.sent.map(event => event.type), ['session.accepted', 'assistant.delta', 'assistant.complete']);
  assert.deepEqual(socket.sent.map(event => event.sequence), [0, 1, 2]);
});

test('splits large deltas without splitting Unicode surrogate pairs', async () => {
  const text = '😀'.repeat(5000);
  const { socket } = connect({
    runtime: {
      async open() {},
      async *turn() {
        yield { type: 'assistant.delta', text };
        yield { type: 'assistant.complete', text };
      }
    }
  });
  socket.receive(openEvent());
  await waitFor(() => socket.sent.length === 1);
  socket.receive(makeEvent({
    sequence: 1,
    type: 'user.turn',
    turnId: 'turn-unicode',
    payload: { text: 'test', source: 'typed', locale: 'en-IN' }
  }));
  await waitFor(() => socket.sent.length === 4);
  const deltas = socket.sent.filter(event => event.type === 'assistant.delta');
  assert.equal(deltas.length, 2);
  assert.ok(deltas.every(event => event.payload.text.length <= 8000));
  assert.equal(deltas.map(event => event.payload.text).join(''), text);
});

test('rejects a device ID that does not match the authenticated token', async () => {
  const { socket } = connect();
  socket.receive(openEvent('other-device'));
  await waitFor(() => socket.closeCode !== null);
  assert.equal(socket.closeCode, 1008);
  assert.equal(socket.sent.length, 0);
});

test('rejects out-of-order events and reports a protocol error', async () => {
  const { socket } = connect();
  socket.receive(openEvent());
  await waitFor(() => socket.sent.length === 1);
  socket.receive(makeEvent({
    sequence: 2,
    type: 'user.turn',
    turnId: 'turn-gap',
    payload: { text: 'Hi', source: 'typed', locale: 'en-IN' }
  }));
  await waitFor(() => socket.closeCode !== null);
  assert.equal(socket.closeCode, 1008);
  assert.equal(socket.sent[1].type, 'session.error');
  assert.equal(socket.sent[1].payload.code, 'INVALID_REQUEST');
});

test('requires TLS and an authenticated bearer device token', async () => {
  const insecure = connect({ secure: false });
  insecure.socket.receive(openEvent());
  await waitFor(() => insecure.socket.closeCode !== null);
  assert.equal(insecure.socket.closeCode, 1008);

  const unauthenticated = connect({ authenticate: async () => null });
  unauthenticated.socket.receive(openEvent());
  await waitFor(() => unauthenticated.socket.closeCode !== null);
  assert.equal(unauthenticated.socket.closeCode, 1008);
});

test('does not accept capability execution events in the chat-only gateway alpha', async () => {
  const { socket } = connect();
  socket.receive(openEvent());
  await waitFor(() => socket.sent.length === 1);
  socket.receive(makeEvent({
    sequence: 1,
    type: 'capability.execute',
    payload: {
      executionId: 'exec-1',
      capabilityId: 'timer.create',
      input: { seconds: 30 },
      grantId: 'grant-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      requiresApproval: false
    }
  }));
  await waitFor(() => socket.closeCode !== null);
  assert.equal(socket.closeCode, 1008);
  assert.equal(socket.sent[1].type, 'session.error');
});
