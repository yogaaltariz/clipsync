import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestServer } from './helpers/testServer.js';
import { createDevicesRepo } from '../src/db/devices.repo.js';
import { generateDeviceKeys, signRequest } from './helpers/testKeys.js';

describe('deviceAuth middleware (via GET /__test/protected)', () => {
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
    const res = await request(ctx.app).get('/__test/protected');
    expect(res.status).toBe(401);
  });

  it('accepts a request with a valid signature from a paired device', async () => {
    ctx = buildTestServer();
    const { deviceId, keys } = pairedDevice();
    const headers = signRequest(keys.privateKeyAuth, 'GET', '/__test/protected');
    headers['X-ClipSync-Device-Id'] = deviceId;
    const res = await request(ctx.app).get('/__test/protected').set(headers);
    expect(res.status).toBe(200);
  });

  it('rejects an unknown device id', async () => {
    ctx = buildTestServer();
    const { keys } = pairedDevice();
    const headers = signRequest(keys.privateKeyAuth, 'GET', '/__test/protected');
    headers['X-ClipSync-Device-Id'] = 'someone-else';
    const res = await request(ctx.app).get('/__test/protected').set(headers);
    expect(res.status).toBe(401);
  });

  it('rejects a stale timestamp outside the auth window', async () => {
    ctx = buildTestServer();
    const { deviceId, keys } = pairedDevice();
    const staleTimestamp = String(Date.now() - 60_000);
    const headers = signRequest(keys.privateKeyAuth, 'GET', '/__test/protected', Buffer.alloc(0), staleTimestamp);
    headers['X-ClipSync-Device-Id'] = deviceId;
    const res = await request(ctx.app).get('/__test/protected').set(headers);
    expect(res.status).toBe(401);
  });

  it('rejects a revoked device', async () => {
    ctx = buildTestServer();
    const { deviceId, keys, repo } = pairedDevice();
    repo.revokeDevice(deviceId);
    const headers = signRequest(keys.privateKeyAuth, 'GET', '/__test/protected');
    headers['X-ClipSync-Device-Id'] = deviceId;
    const res = await request(ctx.app).get('/__test/protected').set(headers);
    expect(res.status).toBe(401);
  });
});
