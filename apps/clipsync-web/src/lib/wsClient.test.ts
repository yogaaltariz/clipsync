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

  it('strips a trailing slash from baseUrl so the websocket URL has no doubled slash', async () => {
    const { authKeyPair } = await generateDeviceKeys();
    wss = new WebSocketServer({ port: 0 });
    const port = (wss.address() as { port: number }).port;

    // Capture the raw request path/query as the server actually received it.
    // (Parsing this with `new URL(rawUrl, 'http://localhost')` would silently
    // absorb a leading "//" into the host component instead of surfacing it
    // as a doubled path separator, so assert on the raw string directly.)
    const rawUrl = await new Promise<string>((resolve) => {
      wss.on('connection', (_ws, req) => {
        resolve(req.url ?? '');
      });
      client = createWsClient({
        baseUrl: `http://127.0.0.1:${port}/`,
        deviceId: 'device-1',
        authPrivateKey: authKeyPair.privateKey,
        onEvent: () => {},
        onStatusChange: () => {},
      });
    });

    expect(rawUrl.startsWith('/clipboard')).toBe(true);
    expect(rawUrl.startsWith('//')).toBe(false);
  });

  it('strips multiple trailing slashes from baseUrl', async () => {
    const { authKeyPair } = await generateDeviceKeys();
    wss = new WebSocketServer({ port: 0 });
    const port = (wss.address() as { port: number }).port;

    const rawUrl = await new Promise<string>((resolve) => {
      wss.on('connection', (_ws, req) => {
        resolve(req.url ?? '');
      });
      client = createWsClient({
        baseUrl: `http://127.0.0.1:${port}///`,
        deviceId: 'device-1',
        authPrivateKey: authKeyPair.privateKey,
        onEvent: () => {},
        onStatusChange: () => {},
      });
    });

    expect(rawUrl.startsWith('/clipboard')).toBe(true);
    expect(rawUrl.startsWith('//')).toBe(false);
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

  it('does not open a socket if close() is called synchronously before connection completes', async () => {
    const { authKeyPair } = await generateDeviceKeys();
    wss = new WebSocketServer({ port: 0 });
    const port = (wss.address() as { port: number }).port;

    const statuses: string[] = [];
    // Create and immediately close (synchronous, no await in between)
    client = createWsClient({
      baseUrl: `http://127.0.0.1:${port}`,
      deviceId: 'device-1',
      authPrivateKey: authKeyPair.privateKey,
      onEvent: () => {},
      onStatusChange: (status) => statuses.push(status),
    });
    client.close();

    // Wait for any pending operations to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify the server never received a connection
    expect(wss.clients.size).toBe(0);
    // The bail-out path must still emit a terminal 'closed' status — otherwise
    // the caller is stuck seeing 'connecting' forever.
    expect(statuses).toContain('closed');
  });

  it('automatically reconnects after the server closes the connection', async () => {
    const { authKeyPair } = await generateDeviceKeys();
    wss = new WebSocketServer({ port: 0 });
    const port = (wss.address() as { port: number }).port;

    let connectionCount = 0;
    const secondConnectionPromise = new Promise<void>((resolve) => {
      wss.on('connection', (ws) => {
        connectionCount += 1;
        if (connectionCount === 1) {
          // Simulate a server-initiated disconnect shortly after connecting.
          setTimeout(() => ws.close(), 50);
        } else if (connectionCount === 2) {
          resolve();
        }
      });
    });

    client = createWsClient({
      baseUrl: `http://127.0.0.1:${port}`,
      deviceId: 'device-1',
      authPrivateKey: authKeyPair.privateKey,
      onEvent: () => {},
      onStatusChange: () => {},
    });

    await secondConnectionPromise;
    expect(connectionCount).toBe(2);
  }, 10000);
});
