import { randomUUID } from 'node:crypto';
import { createAmeEvent, validateAmeEvent } from '@veyminore/zetro-ame-protocol';

const MAX_EVENT_BYTES = 64 * 1024;
const MAX_QUEUED_BYTES = 256 * 1024;
const MAX_ASSISTANT_DELTA_CHARS = 8000;
const TURN_TIMEOUT_MS = 80_000;

function isNonEmptyString(value, max = 256) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function toText(data, isBinary) {
  if (isBinary) throw new Error('Binary AME frames are not supported');
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  throw new Error('Unsupported WebSocket message type');
}

function splitText(text, limit) {
  const chunks = [];
  let chunk = '';
  for (const point of text) {
    if (chunk.length + point.length > limit) {
      chunks.push(chunk);
      chunk = '';
    }
    chunk += point;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

/**
 * Attach the AME v0.1 protocol handler to a ws-compatible WebSocketServer.
 *
 * The host must provide a TLS-only WebSocketServer configured with maxPayload
 * <= 64 KiB, plus an authenticator that validates bearer credentials and
 * returns the credential-bound deviceId. This adapter never receives provider
 * credentials and never executes Android capabilities.
 */
export function attachAmeGateway({
  webSocketServer,
  authenticate,
  runtime,
  isSecureRequest = request => request?.socket?.encrypted === true,
  onError = () => {},
  maxEventBytes = MAX_EVENT_BYTES,
  maxQueuedBytes = MAX_QUEUED_BYTES
}) {
  if (!webSocketServer || typeof webSocketServer.on !== 'function' || typeof webSocketServer.off !== 'function') {
    throw new Error('A ws-compatible WebSocketServer with on/off is required');
  }
  if (typeof authenticate !== 'function') throw new Error('A device-token authenticator is required');
  if (!runtime || typeof runtime.open !== 'function' || typeof runtime.turn !== 'function') {
    throw new Error('A conversation runtime implementing open/turn is required');
  }
  if (!Number.isSafeInteger(maxEventBytes) || maxEventBytes < 1024 || maxEventBytes > MAX_EVENT_BYTES) {
    throw new Error('maxEventBytes must be between 1024 and 65536');
  }
  if (!Number.isSafeInteger(maxQueuedBytes) || maxQueuedBytes < maxEventBytes || maxQueuedBytes > 1024 * 1024) {
    throw new Error('maxQueuedBytes must be >= maxEventBytes and <= 1 MiB');
  }

  const connections = new Set();

  const report = (error, context) => {
    try { onError({ error, ...context }); } catch { /* observer errors must not break transport cleanup */ }
  };

  const onConnection = (socket, request) => {
    const state = {
      authenticated: null,
      opened: false,
      closed: false,
      sessionId: null,
      conversationId: null,
      inboundSequence: -1,
      outboundSequence: 0,
      eventIds: new Set(),
      activeController: null,
      chain: Promise.resolve(),
      queuedBytes: 0
    };
    connections.add(socket);

    const close = (code, reason) => {
      if (state.closed) return;
      state.closed = true;
      state.activeController?.abort();
      try { socket.close(code, reason.slice(0, 120)); } catch { /* socket may already be closed */ }
    };

    const send = (type, payload, turnId = null) => {
      if (state.closed || !state.opened) return false;
      const event = createAmeEvent({
        eventId: randomUUID(),
        sessionId: state.sessionId,
        turnId,
        sequence: state.outboundSequence++,
        timestamp: new Date().toISOString(),
        type,
        payload
      });
      try {
        socket.send(JSON.stringify(event), error => {
          if (error) report(error, { phase: 'send', sessionId: state.sessionId });
        });
        return true;
      } catch (error) {
        report(error, { phase: 'send', sessionId: state.sessionId });
        close(1011, 'Gateway send failed');
        return false;
      }
    };

    const sendProtocolError = (code, message, retryable = false) => {
      if (!state.opened || state.closed) return;
      try {
        send('session.error', { code, message: message.slice(0, 1000), retryable });
      } catch (error) {
        report(error, { phase: 'protocol-error', sessionId: state.sessionId });
      }
    };

    const authenticatePromise = Promise.resolve().then(async () => {
      if (!isSecureRequest(request)) throw new Error('TLS is required for the AME WebSocket connection');
      const authorization = request?.headers?.authorization;
      if (typeof authorization !== 'string' || !/^Bearer\s+\S+$/i.test(authorization)) {
        throw new Error('A bearer device token is required');
      }
      const identity = await authenticate({ authorization, request });
      if (!identity || !isNonEmptyString(identity.deviceId, 160)) {
        throw new Error('Device token is invalid or revoked');
      }
      state.authenticated = { deviceId: identity.deviceId };
      return state.authenticated;
    });

    const processMessage = async text => {
      const identity = await authenticatePromise;
      if (state.closed) return;
      let event;
      try {
        event = JSON.parse(text);
      } catch {
        throw new Error('AME message is not valid JSON');
      }
      const validation = validateAmeEvent(event);
      if (!validation.valid) throw new Error('Invalid AME event: ' + validation.errors.join('; '));
      if (state.eventIds.has(event.eventId)) throw new Error('Duplicate AME eventId');
      if (state.eventIds.size >= 4096) throw new Error('Too many events in one AME session');
      state.eventIds.add(event.eventId);

      if (!state.opened) {
        if (event.type !== 'session.open' || event.sequence !== 0) {
          throw new Error('The first AME event must be session.open with sequence 0');
        }
        if (event.payload.deviceId !== identity.deviceId) {
          throw new Error('session.open deviceId does not match authenticated device');
        }
        state.sessionId = event.sessionId;
        state.inboundSequence = 0;
        state.conversationId = event.payload.conversationId || randomUUID();
        await runtime.open({
          conversationId: state.conversationId,
          principalId: identity.deviceId
        });
        state.opened = true;
        send('session.accepted', {
          conversationId: state.conversationId,
          serverTime: new Date().toISOString(),
          capabilities: []
        });
        return;
      }

      if (event.sessionId !== state.sessionId) throw new Error('AME event belongs to another session');
      if (event.sequence !== state.inboundSequence + 1) {
        throw new Error('AME event sequence is duplicate or out of order');
      }
      if (event.type === 'session.open') throw new Error('An AME session is already open');
      state.inboundSequence = event.sequence;

      if (event.type === 'session.close') {
        close(1000, 'AME session closed');
        return;
      }
      if (event.type !== 'user.turn') {
        throw new Error('This gateway alpha accepts only user.turn and session.close after session.open');
      }
      if (!isNonEmptyString(event.turnId, 160)) throw new Error('user.turn requires a turnId');

      const controller = new AbortController();
      let turnTimedOut = false;
      const turnTimeout = setTimeout(() => {
        turnTimedOut = true;
        controller.abort();
      }, TURN_TIMEOUT_MS);
      turnTimeout.unref?.();
      state.activeController = controller;
      try {
        for await (const update of runtime.turn({
          conversationId: state.conversationId,
          principalId: identity.deviceId,
          turnId: event.turnId,
          text: event.payload.text,
          signal: controller.signal
        })) {
          if (state.closed || controller.signal.aborted) break;
          if (update.type === 'assistant.delta') {
            for (const chunk of splitText(update.text, MAX_ASSISTANT_DELTA_CHARS)) {
              if (!send('assistant.delta', { text: chunk }, event.turnId)) break;
            }
          } else if (update.type === 'assistant.complete') {
            send('assistant.complete', { text: update.text }, event.turnId);
          }
        }
      } catch (error) {
        if (!state.closed) {
          report(error, { phase: 'turn', sessionId: state.sessionId, turnId: event.turnId });
          if (turnTimedOut) {
            sendProtocolError('TURN_TIMEOUT', 'ZETRO response timed out. Please retry.', true);
          } else if (!controller.signal.aborted) {
            sendProtocolError('TURN_FAILED', 'ZETRO could not complete this response.', true);
          }
        }
      } finally {
        clearTimeout(turnTimeout);
        if (state.activeController === controller) state.activeController = null;
      }
    };

    socket.on('message', (data, isBinary) => {
      let text;
      try {
        text = toText(data, isBinary);
        const bytes = Buffer.byteLength(text, 'utf8');
        if (bytes > maxEventBytes) {
          close(1009, 'AME event too large');
          return;
        }
        state.queuedBytes += bytes;
        if (state.queuedBytes > maxQueuedBytes) {
          close(1008, 'AME receive queue limit exceeded');
          return;
        }
        state.chain = state.chain.then(() => processMessage(text)).catch(error => {
          report(error, { phase: 'receive', sessionId: state.sessionId });
          if (state.opened) sendProtocolError('INVALID_REQUEST', 'The AME request could not be processed.');
          close(1008, 'Invalid AME request');
        }).finally(() => {
          state.queuedBytes = Math.max(0, state.queuedBytes - Buffer.byteLength(text, 'utf8'));
        });
      } catch (error) {
        report(error, { phase: 'receive', sessionId: state.sessionId });
        close(1009, 'Invalid AME frame');
      }
    });

    socket.on('close', () => {
      state.closed = true;
      state.activeController?.abort();
      connections.delete(socket);
    });
    socket.on('error', error => {
      report(error, { phase: 'socket', sessionId: state.sessionId });
      close(1011, 'AME socket error');
    });
  };

  webSocketServer.on('connection', onConnection);

  return {
    close() {
      webSocketServer.off('connection', onConnection);
      for (const socket of connections) {
        try { socket.close(1001, 'AME gateway shutting down'); } catch { /* already closed */ }
      }
      connections.clear();
    }
  };
}

export { PostgresDeviceTokenService } from './device-tokens.js';

export { createVercelAmeRoute } from './vercel.js';
