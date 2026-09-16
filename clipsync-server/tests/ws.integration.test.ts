import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import WebSocket from 'ws';
import { createHttpServer } from '../src/server.js';
import { openDb } from '../src/db/client.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateDeviceKeys, signRequest } from './helpers/testKeys.js';

describe('WebSocket real-time updates', () => {
  let dataDir: string;
  let httpServer: ReturnType<typeof createHttpServer>['server'];

  afterEach(() => {
    httpServer?.close();
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('pushes clipboard.created to a connected authenticated client when another device posts an item', async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipsync-ws-'));
    const db = openDb(path.join(dataDir, 'clipsync.db'));
    const blobDir = path.join(dataDir, 'blobs');
    fs.mkdirSync(blobDir, { recursive: true });
    const { server, } = createHttpServer(db, blobDir);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    const httpApp = `http://127.0.0.1:${port}`;
    const start = await request(httpApp).post('/api/pairing/start').send({ initiatorDeviceName: 'Mac' });
    const keys = generateDeviceKeys();
    const complete = await request(httpApp).post('/api/pairing/complete').send({
      token: start.body.token,
      deviceName: 'Mac',
      publicKeyAuthJwk: keys.publicKeyAuthJwk,
      publicKeyExchangeJwk: keys.publicKeyExchangeJwk,
    });
    const deviceId = complete.body.deviceId;

    const timestamp = String(Date.now());
    const headers = signRequest(keys.privateKeyAuth, 'GET', '/clipboard', Buffer.alloc(0), timestamp);
    const wsUrl = `ws://127.0.0.1:${port}/clipboard?deviceId=${deviceId}&timestamp=${timestamp}&signature=${encodeURIComponent(headers['X-ClipSync-Signature'])}`;
    const socket = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });

    const received = new Promise((resolve) => socket.once('message', (data) => resolve(JSON.parse(data.toString()))));

    const postBody = Buffer.from(JSON.stringify({ contentType: 'text/plain', ciphertext: 'hello' }));
    const postHeaders = signRequest(keys.privateKeyAuth, 'POST', '/api/clipboard', postBody);
    postHeaders['X-ClipSync-Device-Id'] = deviceId;
    await request(httpApp).post('/api/clipboard').set(postHeaders).send(JSON.parse(postBody.toString()));

    const message = (await received) as any;
    expect(message.type).toBe('clipboard.created');
    expect(message.item.ciphertext).toBe('hello');
    socket.close();
  });

  it('rejects a WebSocket handshake with an invalid signature', async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipsync-ws-'));
    const db = openDb(path.join(dataDir, 'clipsync.db'));
    const { server } = createHttpServer(db, path.join(dataDir, 'blobs'));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    const socket = new WebSocket(`ws://127.0.0.1:${port}/clipboard?deviceId=nobody&timestamp=${Date.now()}&signature=bad`);
    const result = await new Promise((resolve) => {
      socket.once('close', (code) => resolve({ type: 'close', code }));
      socket.once('error', (err) => resolve({ type: 'error', code: (err as any).code }));
    });
    expect(result.type).toBe('error');
  });
});
