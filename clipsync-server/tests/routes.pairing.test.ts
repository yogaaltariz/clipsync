import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestServer } from './helpers/testServer.js';
import { generateDeviceKeys, signRequest } from './helpers/testKeys.js';

describe('pairing flow', () => {
  let ctx: ReturnType<typeof buildTestServer>;
  afterEach(() => ctx?.cleanup());

  it('starts a pairing session with no auth when no devices are paired yet', async () => {
    ctx = buildTestServer();
    const res = await request(ctx.app).post('/api/pairing/start').send({ initiatorDeviceName: "Yoga's Mac" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTypeOf('string');
    expect(res.body.expiresAt).toBeTypeOf('string');
  });

  it('completes pairing with a valid token and registers the device', async () => {
    ctx = buildTestServer();
    const start = await request(ctx.app).post('/api/pairing/start').send({ initiatorDeviceName: "Yoga's Mac" });
    const keys = generateDeviceKeys();
    const complete = await request(ctx.app).post('/api/pairing/complete').send({
      token: start.body.token,
      deviceName: "Yoga's Pixel",
      publicKeyAuthJwk: keys.publicKeyAuthJwk,
      publicKeyExchangeJwk: keys.publicKeyExchangeJwk,
    });
    expect(complete.status).toBe(200);
    expect(complete.body.deviceId).toBeTypeOf('string');
  });

  it('rejects completing a pairing session twice', async () => {
    ctx = buildTestServer();
    const start = await request(ctx.app).post('/api/pairing/start').send({ initiatorDeviceName: "Yoga's Mac" });
    const keys = generateDeviceKeys();
    const payload = {
      token: start.body.token,
      deviceName: "Yoga's Pixel",
      publicKeyAuthJwk: keys.publicKeyAuthJwk,
      publicKeyExchangeJwk: keys.publicKeyExchangeJwk,
    };
    await request(ctx.app).post('/api/pairing/complete').send(payload);
    const second = await request(ctx.app).post('/api/pairing/complete').send(payload);
    expect(second.status).toBe(410);
  });

  it('rejects starting a third pairing once two devices are active', async () => {
    ctx = buildTestServer();
    // Pair device 1 (bootstrap, unauthenticated start).
    const start1 = await request(ctx.app).post('/api/pairing/start').send({ initiatorDeviceName: 'Mac' });
    const keys1 = generateDeviceKeys();
    const c1 = await request(ctx.app).post('/api/pairing/complete').send({
      token: start1.body.token,
      deviceName: 'Mac',
      publicKeyAuthJwk: keys1.publicKeyAuthJwk,
      publicKeyExchangeJwk: keys1.publicKeyExchangeJwk,
    });

    // Pair device 2, authenticated as device 1.
    const headers1 = signRequest(keys1.privateKeyAuth, 'POST', '/api/pairing/start', Buffer.from(JSON.stringify({ initiatorDeviceName: 'Mac' })));
    headers1['X-ClipSync-Device-Id'] = c1.body.deviceId;
    const start2 = await request(ctx.app)
      .post('/api/pairing/start')
      .set(headers1)
      .send({ initiatorDeviceName: 'Mac' });
    const keys2 = generateDeviceKeys();
    await request(ctx.app).post('/api/pairing/complete').send({
      token: start2.body.token,
      deviceName: 'Pixel',
      publicKeyAuthJwk: keys2.publicKeyAuthJwk,
      publicKeyExchangeJwk: keys2.publicKeyExchangeJwk,
    });

    // A third start, authenticated as device 1, must be refused.
    const bodyBuf = Buffer.from(JSON.stringify({ initiatorDeviceName: 'Mac' }));
    const headers3 = signRequest(keys1.privateKeyAuth, 'POST', '/api/pairing/start', bodyBuf);
    headers3['X-ClipSync-Device-Id'] = c1.body.deviceId;
    const start3 = await request(ctx.app).post('/api/pairing/start').set(headers3).send({ initiatorDeviceName: 'Mac' });
    expect(start3.status).toBe(409);
  });

  it('unpairs a device so it can no longer authenticate', async () => {
    ctx = buildTestServer();
    const start = await request(ctx.app).post('/api/pairing/start').send({ initiatorDeviceName: 'Mac' });
    const keys = generateDeviceKeys();
    const complete = await request(ctx.app).post('/api/pairing/complete').send({
      token: start.body.token,
      deviceName: 'Mac',
      publicKeyAuthJwk: keys.publicKeyAuthJwk,
      publicKeyExchangeJwk: keys.publicKeyExchangeJwk,
    });
    const deviceId = complete.body.deviceId;
    const headers = signRequest(keys.privateKeyAuth, 'DELETE', `/api/pairing/devices/${deviceId}`);
    headers['X-ClipSync-Device-Id'] = deviceId;
    const unpair = await request(ctx.app).delete(`/api/pairing/devices/${deviceId}`).set(headers);
    expect(unpair.status).toBe(204);

    const headersAfter = signRequest(keys.privateKeyAuth, 'GET', '/healthz');
    headersAfter['X-ClipSync-Device-Id'] = deviceId;
    // healthz isn't protected, so assert against the pairing endpoint instead:
    const startAfter = signRequest(keys.privateKeyAuth, 'POST', '/api/pairing/start', Buffer.from(JSON.stringify({ initiatorDeviceName: 'Mac' })));
    startAfter['X-ClipSync-Device-Id'] = deviceId;
    const res = await request(ctx.app).post('/api/pairing/start').set(startAfter).send({ initiatorDeviceName: 'Mac' });
    expect(res.status).toBe(401);
  });

  it('device A revokes a different device B, preventing B from authenticating', async () => {
    ctx = buildTestServer();
    // Pair device A (bootstrap).
    const startA = await request(ctx.app).post('/api/pairing/start').send({ initiatorDeviceName: 'Mac' });
    const keysA = generateDeviceKeys();
    const completeA = await request(ctx.app).post('/api/pairing/complete').send({
      token: startA.body.token,
      deviceName: 'Mac',
      publicKeyAuthJwk: keysA.publicKeyAuthJwk,
      publicKeyExchangeJwk: keysA.publicKeyExchangeJwk,
    });
    const deviceIdA = completeA.body.deviceId;

    // Pair device B, authenticated as device A.
    const headersB = signRequest(keysA.privateKeyAuth, 'POST', '/api/pairing/start', Buffer.from(JSON.stringify({ initiatorDeviceName: 'Pixel' })));
    headersB['X-ClipSync-Device-Id'] = deviceIdA;
    const startB = await request(ctx.app)
      .post('/api/pairing/start')
      .set(headersB)
      .send({ initiatorDeviceName: 'Pixel' });
    const keysB = generateDeviceKeys();
    const completeB = await request(ctx.app).post('/api/pairing/complete').send({
      token: startB.body.token,
      deviceName: 'Pixel',
      publicKeyAuthJwk: keysB.publicKeyAuthJwk,
      publicKeyExchangeJwk: keysB.publicKeyExchangeJwk,
    });
    const deviceIdB = completeB.body.deviceId;

    // A revokes B.
    const headersRevoke = signRequest(keysA.privateKeyAuth, 'DELETE', `/api/pairing/devices/${deviceIdB}`);
    headersRevoke['X-ClipSync-Device-Id'] = deviceIdA;
    const revoke = await request(ctx.app).delete(`/api/pairing/devices/${deviceIdB}`).set(headersRevoke);
    expect(revoke.status).toBe(204);

    // B attempts to authenticate, should be rejected.
    const headersB2 = signRequest(keysB.privateKeyAuth, 'POST', '/api/pairing/start', Buffer.from(JSON.stringify({ initiatorDeviceName: 'Pixel' })));
    headersB2['X-ClipSync-Device-Id'] = deviceIdB;
    const res = await request(ctx.app).post('/api/pairing/start').set(headersB2).send({ initiatorDeviceName: 'Pixel' });
    expect(res.status).toBe(401);
  });

  it('bootstrap re-opens when both devices are revoked', async () => {
    ctx = buildTestServer();
    // Pair device A (bootstrap).
    const startA = await request(ctx.app).post('/api/pairing/start').send({ initiatorDeviceName: 'Mac' });
    const keysA = generateDeviceKeys();
    const completeA = await request(ctx.app).post('/api/pairing/complete').send({
      token: startA.body.token,
      deviceName: 'Mac',
      publicKeyAuthJwk: keysA.publicKeyAuthJwk,
      publicKeyExchangeJwk: keysA.publicKeyExchangeJwk,
    });
    const deviceIdA = completeA.body.deviceId;

    // Pair device B, authenticated as device A.
    const headersB = signRequest(keysA.privateKeyAuth, 'POST', '/api/pairing/start', Buffer.from(JSON.stringify({ initiatorDeviceName: 'Pixel' })));
    headersB['X-ClipSync-Device-Id'] = deviceIdA;
    const startB = await request(ctx.app)
      .post('/api/pairing/start')
      .set(headersB)
      .send({ initiatorDeviceName: 'Pixel' });
    const keysB = generateDeviceKeys();
    const completeB = await request(ctx.app).post('/api/pairing/complete').send({
      token: startB.body.token,
      deviceName: 'Pixel',
      publicKeyAuthJwk: keysB.publicKeyAuthJwk,
      publicKeyExchangeJwk: keysB.publicKeyExchangeJwk,
    });
    const deviceIdB = completeB.body.deviceId;

    // A revokes B.
    const headersRevokeB = signRequest(keysA.privateKeyAuth, 'DELETE', `/api/pairing/devices/${deviceIdB}`);
    headersRevokeB['X-ClipSync-Device-Id'] = deviceIdA;
    await request(ctx.app).delete(`/api/pairing/devices/${deviceIdB}`).set(headersRevokeB);

    // A revokes itself.
    const headersRevokeA = signRequest(keysA.privateKeyAuth, 'DELETE', `/api/pairing/devices/${deviceIdA}`);
    headersRevokeA['X-ClipSync-Device-Id'] = deviceIdA;
    await request(ctx.app).delete(`/api/pairing/devices/${deviceIdA}`).set(headersRevokeA);

    // Bootstrap should re-open: POST /api/pairing/start with no auth should succeed.
    const res = await request(ctx.app).post('/api/pairing/start').send({ initiatorDeviceName: 'NewMac' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTypeOf('string');
  });

  it('returns peerDevices in complete response when peer exists', async () => {
    ctx = buildTestServer();
    // Pair device A (bootstrap).
    const startA = await request(ctx.app).post('/api/pairing/start').send({ initiatorDeviceName: 'Mac' });
    const keysA = generateDeviceKeys();
    const completeA = await request(ctx.app).post('/api/pairing/complete').send({
      token: startA.body.token,
      deviceName: 'Mac',
      publicKeyAuthJwk: keysA.publicKeyAuthJwk,
      publicKeyExchangeJwk: keysA.publicKeyExchangeJwk,
    });
    const deviceIdA = completeA.body.deviceId;

    // Pair device B, authenticated as device A.
    const headersB = signRequest(keysA.privateKeyAuth, 'POST', '/api/pairing/start', Buffer.from(JSON.stringify({ initiatorDeviceName: 'Pixel' })));
    headersB['X-ClipSync-Device-Id'] = deviceIdA;
    const startB = await request(ctx.app)
      .post('/api/pairing/start')
      .set(headersB)
      .send({ initiatorDeviceName: 'Pixel' });
    const keysB = generateDeviceKeys();
    const completeB = await request(ctx.app).post('/api/pairing/complete').send({
      token: startB.body.token,
      deviceName: 'Pixel',
      publicKeyAuthJwk: keysB.publicKeyAuthJwk,
      publicKeyExchangeJwk: keysB.publicKeyExchangeJwk,
    });

    // B's response should contain A in peerDevices.
    expect(completeB.body.peerDevices).toBeInstanceOf(Array);
    expect(completeB.body.peerDevices.length).toBe(1);
    expect(completeB.body.peerDevices[0].deviceId).toBe(deviceIdA);
    expect(completeB.body.peerDevices[0].deviceName).toBe('Mac');
    expect(completeB.body.peerDevices[0].publicKeyExchangeJwk).toBe(keysA.publicKeyExchangeJwk);
  });

  it('rejects a garbage publicKeyAuthJwk with 400 and does not consume the pairing session', async () => {
    ctx = buildTestServer();
    const start = await request(ctx.app).post('/api/pairing/start').send({ initiatorDeviceName: 'Mac' });
    const keys = generateDeviceKeys();

    const badAttempt = await request(ctx.app).post('/api/pairing/complete').send({
      token: start.body.token,
      deviceName: 'Mac',
      publicKeyAuthJwk: 'not-a-jwk-at-all',
      publicKeyExchangeJwk: keys.publicKeyExchangeJwk,
    });
    expect(badAttempt.status).toBe(400);
    expect(badAttempt.body.error).toBe('invalid_public_key');

    // The session must still be usable: the bad request must not have marked it used
    // or inserted a broken device row.
    const goodAttempt = await request(ctx.app).post('/api/pairing/complete').send({
      token: start.body.token,
      deviceName: 'Mac',
      publicKeyAuthJwk: keys.publicKeyAuthJwk,
      publicKeyExchangeJwk: keys.publicKeyExchangeJwk,
    });
    expect(goodAttempt.status).toBe(200);
    expect(goodAttempt.body.deviceId).toBeTypeOf('string');
  });

  it('returns 400 (not 500) when POST /api/pairing/start is sent with no body at all', async () => {
    ctx = buildTestServer();
    // No .send(...) at all: no Content-Type header, no body bytes. Under Express 5 /
    // body-parser 2, req.body is `undefined` here, not `{}`.
    const res = await request(ctx.app).post('/api/pairing/start');
    expect(res.status).toBe(400);
  });

  it('returns 413 (not 500) for a JSON body over the 1 MB limit', async () => {
    ctx = buildTestServer();
    const oversized = 'x'.repeat(2 * 1024 * 1024); // 2 MB, well over config.maxJsonBodyBytes (1 MB)
    const res = await request(ctx.app)
      .post('/api/pairing/start')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ initiatorDeviceName: oversized }));
    expect(res.status).toBe(413);
    expect(res.body.error).toBe('bad_request');
  });

  it('expires a pairing session past its TTL, returning 410 on complete', async () => {
    ctx = buildTestServer();
    const start = await request(ctx.app).post('/api/pairing/start').send({ initiatorDeviceName: 'Mac' });
    const token = start.body.token as string;

    // Directly manipulate expiresAt in the DB to simulate the TTL having elapsed.
    const past = new Date(Date.now() - 60_000).toISOString();
    ctx.db.prepare('UPDATE pairing_sessions SET expires_at = ? WHERE token = ?').run(past, token);

    const keys = generateDeviceKeys();
    const res = await request(ctx.app).post('/api/pairing/complete').send({
      token,
      deviceName: 'Mac',
      publicKeyAuthJwk: keys.publicKeyAuthJwk,
      publicKeyExchangeJwk: keys.publicKeyExchangeJwk,
    });
    expect(res.status).toBe(410);
  });
});
