import { EventEmitter } from 'node:events';
import { attachAmeGateway } from './index.js';

const VERCEL_MAX_EVENT_BYTES = 64 * 1024;

/**
 * Build a Vercel Functions GET route using @vercel/functions upgradeWebSocket.
 *
 * The host app passes upgradeWebSocket from @vercel/functions and provides the
 * same runtime/authenticator as attachAmeGateway. The WebSocket connection is
 * scoped to this Function invocation; reconnects create a new invocation and
 * resume the conversation through the opaque conversationId.
 */
export function createVercelAmeRoute({
  upgradeWebSocket,
  runtime,
  authenticate,
  onError = () => {},
  maxEventBytes = VERCEL_MAX_EVENT_BYTES,
  maxQueuedBytes = 256 * 1024
}) {
  if (typeof upgradeWebSocket !== 'function') {
    throw new Error('upgradeWebSocket from @vercel/functions is required');
  }
  if (!runtime || typeof runtime.open !== 'function' || typeof runtime.turn !== 'function') {
    throw new Error('A configured ZETRO conversation runtime is required');
  }
  if (typeof authenticate !== 'function') {
    throw new Error('A device-token authenticator is required');
  }

  return async function GET(request) {
    if (request?.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET' } });
    }

    const url = new URL(request.url);
    if (url.protocol !== 'https:') {
      return new Response('HTTPS is required', { status: 400 });
    }

    return upgradeWebSocket((socket) => {
      // upgradeWebSocket supplies an upgraded ws-compatible socket. Reuse the
      // exact protocol/authentication implementation shared with Node hosts.
      const connectionHub = new EventEmitter();
      const gateway = attachAmeGateway({
        webSocketServer: connectionHub,
        authenticate,
        runtime,
        onError,
        maxEventBytes,
        maxQueuedBytes,
        // Vercel terminates TLS before the Function; this route accepts only
        // an https request URL and never trusts forwarded headers from clients.
        isSecureRequest: hostRequest => hostRequest?.socket?.encrypted === true
      });
      const hostRequest = {
        headers: { authorization: request.headers.get('authorization') },
        socket: { encrypted: true }
      };
      connectionHub.emit('connection', socket, hostRequest);
      socket.once?.('close', () => gateway.close());
    }, { maxPayload: VERCEL_MAX_EVENT_BYTES });
  };
}
