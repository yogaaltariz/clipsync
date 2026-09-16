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
  let db: ReturnType<typeof openDb>;

  afterEach(() => {
    httpServer?.close();
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('pushes clipboard.created to a connected authenticated client when another device posts an item', async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipsync-ws-'));
    db = openDb(path.join(dataDir, 'clipsync.db'));
    const blobDir = path.join(dataDir, 'blobs');
    fs.mkdirSync(blobDir, { recursive: true });
    const serverResult = createHttpServer(db, blobDir);
    httpServer = serverResult.server;
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const port = (httpServer.address() as any).port;

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

  it('rejects a WebSocket handshake with an unknown device', async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipsync-ws-'));
    db = openDb(path.join(dataDir, 'clipsync.db'));
    const serverResult = createHttpServer(db, path.join(dataDir, 'blobs'));
    httpServer = serverResult.server;
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const port = (httpServer.address() as any).port;

    const socket = new WebSocket(`ws://127.0.0.1:${port}/clipboard?deviceId=nobody&timestamp=${Date.now()}&signature=bad`);
    const result = await new Promise((resolve) => {
      socket.once('close', (code) => resolve({ type: 'close', code }));
      socket.once('error', (err) => resolve({ type: 'error', code: (err as any).code }));
    });
    expect(result.type).toBe('error');
  });

  it('rejects a WebSocket handshake with a forged signature from a real device', async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipsync-ws-'));
    db = openDb(path.join(dataDir, 'clipsync.db'));
    const serverResult = createHttpServer(db, path.join(dataDir, 'blobs'));
    httpServer = serverResult.server;
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const port = (httpServer.address() as any).port;

    const httpApp = `http://127.0.0.1:${port}`;
    const start = await request(httpApp).post('/api/pairing/start').send({ initiatorDeviceName: 'Device A' });
    const keys = generateDeviceKeys();
    const complete = await request(httpApp).post('/api/pairing/complete').send({
      token: start.body.token,
      deviceName: 'Device A',
      publicKeyAuthJwk: keys.publicKeyAuthJwk,
      publicKeyExchangeJwk: keys.publicKeyExchangeJwk,
    });
    const deviceId = complete.body.deviceId;

    // Use valid device ID and timestamp, but garbled signature (corrupt the base64)
    const timestamp = String(Date.now());
    const garbledSignature = 'invalid_signature_bytes_here_not_valid_base64_or_sig';
    const wsUrl = `ws://127.0.0.1:${port}/clipboard?deviceId=${deviceId}&timestamp=${timestamp}&signature=${encodeURIComponent(garbledSignature)}`;
    const socket = new WebSocket(wsUrl);
    const result = await new Promise((resolve) => {
      socket.once('open', () => resolve({ type: 'open' }));
      socket.once('error', (err) => resolve({ type: 'error', code: (err as any).code }));
    });
    expect(result.type).toBe('error');
  });

  it('closes an existing WebSocket when the device is revoked via unpair', async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipsync-ws-'));
    db = openDb(path.join(dataDir, 'clipsync.db'));
    const serverResult = createHttpServer(db, path.join(dataDir, 'blobs'));
    httpServer = serverResult.server;
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const port = (httpServer.address() as any).port;

    const httpApp = `http://127.0.0.1:${port}`;

    // Pair device A (bootstrap)
    const startA = await request(httpApp).post('/api/pairing/start').send({ initiatorDeviceName: 'Device A' });
    const keysA = generateDeviceKeys();
    const completeA = await request(httpApp).post('/api/pairing/complete').send({
      token: startA.body.token,
      deviceName: 'Device A',
      publicKeyAuthJwk: keysA.publicKeyAuthJwk,
      publicKeyExchangeJwk: keysA.publicKeyExchangeJwk,
    });
    const deviceIdA = completeA.body.deviceId;

    // Pair device B (requires auth as A)
    const keysB = generateDeviceKeys();
    const startBBody = Buffer.from(JSON.stringify({ initiatorDeviceName: 'Device B' }));
    const startBHeaders = signRequest(keysA.privateKeyAuth, 'POST', '/api/pairing/start', startBBody);
    startBHeaders['X-ClipSync-Device-Id'] = deviceIdA;
    const startB = await request(httpApp)
      .post('/api/pairing/start')
      .set(startBHeaders)
      .send(JSON.parse(startBBody.toString()));

    const completeBPayload = {
      token: startB.body.token,
      deviceName: 'Device B',
      publicKeyAuthJwk: keysB.publicKeyAuthJwk,
      publicKeyExchangeJwk: keysB.publicKeyExchangeJwk,
    };
    const completeBBody = Buffer.from(JSON.stringify(completeBPayload));
    const completeBHeaders = signRequest(keysA.privateKeyAuth, 'POST', '/api/pairing/complete', completeBBody);
    completeBHeaders['X-ClipSync-Device-Id'] = deviceIdA;
    const completeB = await request(httpApp)
      .post('/api/pairing/complete')
      .set(completeBHeaders)
      .send(completeBPayload);
    const deviceIdB = completeB.body.deviceId;

    // Open WebSocket connection as device B
    const wsTimestamp = String(Date.now());
    const wsHeaders = signRequest(keysB.privateKeyAuth, 'GET', '/clipboard', Buffer.alloc(0), wsTimestamp);
    const wsUrl = `ws://127.0.0.1:${port}/clipboard?deviceId=${deviceIdB}&timestamp=${wsTimestamp}&signature=${encodeURIComponent(wsHeaders['X-ClipSync-Signature'])}`;
    const socket = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });

    // B's socket is now open; have A revoke B
    const revokeTimestamp = String(Date.now());
    const revokeHeaders = signRequest(keysA.privateKeyAuth, 'DELETE', `/api/pairing/devices/${deviceIdB}`, Buffer.alloc(0), revokeTimestamp);
    revokeHeaders['X-ClipSync-Device-Id'] = deviceIdA;
    await request(httpApp)
      .delete(`/api/pairing/devices/${deviceIdB}`)
      .set(revokeHeaders);

    // B's socket should close immediately
    const closeEvent = await new Promise((resolve) => {
      socket.once('close', (code) => resolve({ type: 'close', code }));
      socket.once('error', (err) => resolve({ type: 'error' }));
      // Timeout in case it never closes
      setTimeout(() => resolve({ type: 'timeout' }), 1000);
    });
    expect(closeEvent.type).toBe('close');
  });

  it('does not crash the server when a malformed WebSocket frame is received', async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipsync-ws-'));
    db = openDb(path.join(dataDir, 'clipsync.db'));
    const serverResult = createHttpServer(db, path.join(dataDir, 'blobs'));
    httpServer = serverResult.server;
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const port = (httpServer.address() as any).port;

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

    // Send a malformed/unmasked frame (raw data that violates WebSocket protocol)
    const rawSocket = socket as any;
    if (rawSocket._socket) {
      rawSocket._socket.write(Buffer.from([0x81, 0x05, 0x48, 0x65, 0x6c, 0x6c, 0x6f])); // unmasked frame
    }

    // Give server time to handle the error
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Server should still be responsive: make a healthz check
    const healthz = await request(httpApp).get('/healthz');
    expect(healthz.status).toBe(200);

    socket.close();
  });
});
