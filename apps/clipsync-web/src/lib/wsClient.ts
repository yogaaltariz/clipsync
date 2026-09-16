import { signRequest } from './signing.js';
import type { ClipboardItemDto } from './apiClient.js';

export type ClipboardEvent =
  | { type: 'clipboard.created'; item: ClipboardItemDto }
  | { type: 'clipboard.deleted'; id: string }
  | { type: 'clipboard.cleared' };

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export interface WsClientConfig {
  baseUrl: string;
  deviceId: string;
  authPrivateKey: CryptoKey;
  onEvent: (event: ClipboardEvent) => void;
  onStatusChange: (status: ConnectionStatus) => void;
}

export interface WsClient {
  close(): void;
}

const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000];

export function createWsClient({
  baseUrl,
  deviceId,
  authPrivateKey,
  onEvent,
  onStatusChange,
}: WsClientConfig): WsClient {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  let socket: WebSocket | undefined;
  let closedByCaller = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  async function connect() {
    onStatusChange('connecting');
    const { timestamp, signature } = await signRequest(authPrivateKey, 'GET', '/clipboard');
    if (closedByCaller) {
      // close() ran while we were awaiting the signature — never open a socket,
      // but the caller still needs a terminal status instead of being stuck on 'connecting'.
      onStatusChange('closed');
      return;
    }
    const wsBase = normalizedBaseUrl.replace(/^http/, 'ws');
    const url = new URL(`${wsBase}/clipboard`);
    url.searchParams.set('deviceId', deviceId);
    url.searchParams.set('timestamp', timestamp);
    url.searchParams.set('signature', signature);

    socket = new WebSocket(url.toString());

    socket.addEventListener('open', () => {
      reconnectAttempt = 0;
      onStatusChange('open');
    });

    socket.addEventListener('message', (messageEvent) => {
      try {
        const parsed = JSON.parse(messageEvent.data as string) as ClipboardEvent;
        onEvent(parsed);
      } catch {
        // A malformed message from the server is dropped, never thrown —
        // one bad frame must not take down the client's event loop.
      }
    });

    socket.addEventListener('close', () => {
      onStatusChange('closed');
      if (closedByCaller) return;
      const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(() => {
        connect().catch(() => onStatusChange('closed'));
      }, delay);
    });

    socket.addEventListener('error', () => {
      // The subsequent 'close' event drives the reconnect/backoff logic —
      // this listener only exists so an error is never an unhandled
      // exception (browsers can otherwise surface it as one).
    });
  }

  connect().catch(() => onStatusChange('closed'));

  return {
    close() {
      closedByCaller = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    },
  };
}
