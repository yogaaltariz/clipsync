import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestServer } from './helpers/testServer.js';
import { createDevicesRepo } from '../src/db/devices.repo.js';
import { generateDeviceKeys, signRequest } from './helpers/testKeys.js';

describe('deviceAuth middleware (via POST /api/pairing/start)', () => {
  let ctx: ReturnType<typeof buildTestServer>;

  afterEach(() => ctx?.cleanup());

  function pairedDevice() {
    const keys = generateDeviceKeys();
    const repo = createDevicesRepo(ctx.db);
    const deviceId = 'device-1';
    repo.insertDevice({
      deviceId,
      deviceName: 'Test Mac',
      publicKeyAuthJwk: keys.publicKeyAuthJwk,
      publicKeyExchangeJwk: keys.publicKeyExchangeJwk,
      pairedAt: new Date().toISOString(),
      revokedAt: null,
    });
    return { deviceId, keys, repo };
  }

  it('rejects a request with no auth headers', async () => {
    ctx = buildTestServer();
    pairedDevice(); // ensure at least one device exists so auth is required
    const res = await request(ctx.app).post('/api/pairing/start').send({ initiatorDeviceName: 'x' });
    expect(res.status).toBe(401);
  });

  it('accepts a request with a valid signature from a paired device', async () => {
    ctx = buildTestServer();
    const { deviceId, keys } = pairedDevice();
    const bodyBuffer = Buffer.from(JSON.stringify({ initiatorDeviceName: 'x' }));
    const headers = signRequest(keys.privateKeyAuth, 'POST', '/api/pairing/start', bodyBuffer);
    headers['X-ClipSync-Device-Id'] = deviceId;
    const res = await request(ctx.app)
      .post('/api/pairing/start')
      .set(headers)
      .send({ initiatorDeviceName: 'x' });
    expect(res.status).toBe(200);
  });

  it('rejects an unknown device id', async () => {
    ctx = buildTestServer();
    const { keys } = pairedDevice();
    const bodyBuffer = Buffer.from(JSON.stringify({ initiatorDeviceName: 'x' }));
    const headers = signRequest(keys.privateKeyAuth, 'POST', '/api/pairing/start', bodyBuffer);
    headers['X-ClipSync-Device-Id'] = 'someone-else';
    const res = await request(ctx.app)
      .post('/api/pairing/start')
      .set(headers)
      .send({ initiatorDeviceName: 'x' });
    expect(res.status).toBe(401);
  });

  it('rejects a stale timestamp outside the auth window', async () => {
    ctx = buildTestServer();
    const { deviceId, keys } = pairedDevice();
    const bodyBuffer = Buffer.from(JSON.stringify({ initiatorDeviceName: 'x' }));
    const staleTimestamp = String(Date.now() - 60_000);
    const headers = signRequest(keys.privateKeyAuth, 'POST', '/api/pairing/start', bodyBuffer, staleTimestamp);
    headers['X-ClipSync-Device-Id'] = deviceId;
    const res = await request(ctx.app)
      .post('/api/pairing/start')
      .set(headers)
      .send({ initiatorDeviceName: 'x' });
    expect(res.status).toBe(401);
  });

  it('rejects a revoked device', async () => {
    ctx = buildTestServer();
    const { deviceId, keys, repo } = pairedDevice();
    repo.revokeDevice(deviceId);
    const bodyBuffer = Buffer.from(JSON.stringify({ initiatorDeviceName: 'x' }));
    const headers = signRequest(keys.privateKeyAuth, 'POST', '/api/pairing/start', bodyBuffer);
    headers['X-ClipSync-Device-Id'] = deviceId;
    const res = await request(ctx.app)
      .post('/api/pairing/start')
      .set(headers)
      .send({ initiatorDeviceName: 'x' });
    expect(res.status).toBe(401);
  });

  it('accepts a POST request with a valid signature over real JSON body content', async () => {
    ctx = buildTestServer();
    const { deviceId, keys } = pairedDevice();
    const bodyData = { initiatorDeviceName: 'x' };
    const bodyBuffer = Buffer.from(JSON.stringify(bodyData));
    const headers = signRequest(keys.privateKeyAuth, 'POST', '/api/pairing/start', bodyBuffer);
    headers['X-ClipSync-Device-Id'] = deviceId;
    const res = await request(ctx.app)
      .post('/api/pairing/start')
      .set(headers)
      .send(bodyData);
    expect(res.status).toBe(200);
  });

  it('rejects a POST request when body content differs from what was signed', async () => {
    ctx = buildTestServer();
    const { deviceId, keys } = pairedDevice();
    const signedBodyData = { initiatorDeviceName: 'x' };
    const signedBodyBuffer = Buffer.from(JSON.stringify(signedBodyData));
    const headers = signRequest(keys.privateKeyAuth, 'POST', '/api/pairing/start', signedBodyBuffer);
    headers['X-ClipSync-Device-Id'] = deviceId;
    const actualBodyData = { initiatorDeviceName: 'y' };
    const res = await request(ctx.app)
      .post('/api/pairing/start')
      .set(headers)
      .send(actualBodyData);
    expect(res.status).toBe(401);
  });
});
