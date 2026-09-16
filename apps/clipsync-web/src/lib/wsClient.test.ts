// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { generateDeviceKeys } from './deviceIdentity.js';
import { signRequest } from './signing.js';
import { createWsClient } from './wsClient.js';

describe('createWsClient', () => {
  let wss: WebSocketServer;
  let client: ReturnType<typeof createWsClient> | undefined;

  afterEach(() => {
    client?.close();
    wss?.close();
  });

  it('connects with deviceId/timestamp/signature as query parameters', async () => {
    const { authKeyPair } = await generateDeviceKeys();
    const deviceId = 'device-1';

    wss = new WebSocketServer({ port: 0 });
    const port = (wss.address() as { port: number }).port;

    const receivedUrl = await new Promise<URL>((resolve) => {
      wss.on('connection', (_ws, req) => {
        resolve(new URL(req.url ?? '', 'http://localhost'));
      });
      client = createWsClient({
        baseUrl: `http://127.0.0.1:${port}`,
        deviceId,
        authPrivateKey: authKeyPair.privateKey,
        onEvent: () => {},
        onStatusChange: () => {},
      });
    });

    expect(receivedUrl.pathname).toBe('/clipboard');
    expect(receivedUrl.searchParams.get('deviceId')).toBe(deviceId);
    expect(typeof receivedUrl.searchParams.get('timestamp')).toBe('string');
    expect(typeof receivedUrl.searchParams.get('signature')).toBe('string');
  });

  it('reports status transitions: connecting then open', async () => {
    const { authKeyPair } = await generateDeviceKeys();
    wss = new WebSocketServer({ port: 0 });
    const port = (wss.address() as { port: number }).port;

    const statuses: string[] = [];
    const openPromise = new Promise<void>((resolve) => {
      client = createWsClient({
        baseUrl: `http://127.0.0.1:${port}`,
        deviceId: 'device-1',
        authPrivateKey: authKeyPair.privateKey,
        onEvent: () => {},
        onStatusChange: (status) => {
          statuses.push(status);
          if (status === 'open') resolve();
        },
      });
    });
    await openPromise;
    expect(statuses).toEqual(['connecting', 'open']);
  });

  it('parses and forwards a clipboard.created event received from the server', async () => {
    const { authKeyPair } = await generateDeviceKeys();
    wss = new WebSocketServer({ port: 0 });
    const port = (wss.address() as { port: number }).port;

    wss.on('connection', (ws) => {
      ws.send(
        JSON.stringify({
          type: 'clipboard.created',
          item: { id: 'item-1', contentType: 'text/plain', ciphertext: 'x', blobPath: null, deviceId: 'd', deviceName: 'Mac', createdAt: '2026-01-01T00:00:00.000Z' },
        }),
      );
    });

    const eventPromise = new Promise((resolve) => {
      client = createWsClient({
        baseUrl: `http://127.0.0.1:${port}`,
        deviceId: 'device-1',
        authPrivateKey: authKeyPair.privateKey,
        onEvent: resolve,
        onStatusChange: () => {},
      });
    });

    const event = await eventPromise;
    expect(event).toEqual({
      type: 'clipboard.created',
      item: expect.objectContaining({ id: 'item-1', ciphertext: 'x' }),
    });
  });

  it('close() reports a closed status and stops reconnecting', async () => {
    const { authKeyPair } = await generateDeviceKeys();
    wss = new WebSocketServer({ port: 0 });
    const port = (wss.address() as { port: number }).port;

    const statuses: string[] = [];
    await new Promise<void>((resolve) => {
      client = createWsClient({
        baseUrl: `http://127.0.0.1:${port}`,
        deviceId: 'device-1',
        authPrivateKey: authKeyPair.privateKey,
        onEvent: () => {},
        onStatusChange: (status) => {
          statuses.push(status);
          if (status === 'open') resolve();
        },
      });
    });

    client!.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(statuses[statuses.length - 1]).toBe('closed');
  });

  it('canonical string for the handshake matches signRequest over the fixed (GET, /clipboard) pair', async () => {
    const { authKeyPair } = await generateDeviceKeys();
    wss = new WebSocketServer({ port: 0 });
    const port = (wss.address() as { port: number }).port;

    const receivedUrl = await new Promise<URL>((resolve) => {
      wss.on('connection', (_ws, req) => resolve(new URL(req.url ?? '', 'http://localhost')));
      client = createWsClient({
        baseUrl: `http://127.0.0.1:${port}`,
        deviceId: 'device-1',
        authPrivateKey: authKeyPair.privateKey,
        onEvent: () => {},
        onStatusChange: () => {},
      });
    });

    const timestamp = receivedUrl.searchParams.get('timestamp')!;
    const signature = receivedUrl.searchParams.get('signature')!;
    // Reproduce what the client should have signed and confirm it verifies —
    // proves the handshake uses the same scheme signRequest already tests,
    // not a divergent one-off implementation.
    const independentlySigned = await signRequest(authKeyPair.privateKey, 'GET', '/clipboard', undefined, timestamp);
    expect(independentlySigned.signature).toBe(signature);
  });
});
