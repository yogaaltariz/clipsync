import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestServer } from './helpers/testServer.js';
import { generateDeviceKeys, signRequest } from './helpers/testKeys.js';

async function pairFirstDevice(app: import('express').Express) {
  const start = await request(app).post('/api/pairing/start').send({ initiatorDeviceName: 'Mac' });
  const keys = generateDeviceKeys();
  const complete = await request(app).post('/api/pairing/complete').send({
    token: start.body.token,
    deviceName: 'Mac',
    publicKeyAuthJwk: keys.publicKeyAuthJwk,
    publicKeyExchangeJwk: keys.publicKeyExchangeJwk,
  });
  return { deviceId: complete.body.deviceId as string, keys };
}

function authed(keys: ReturnType<typeof generateDeviceKeys>, deviceId: string, method: string, path: string, body?: Buffer) {
  const headers = signRequest(keys.privateKeyAuth, method, path, body ?? Buffer.alloc(0));
  headers['X-ClipSync-Device-Id'] = deviceId;
  return headers;
}

describe('clipboard routes', () => {
  let ctx: ReturnType<typeof buildTestServer>;
  afterEach(() => ctx?.cleanup());

  it('rejects unauthenticated access to every clipboard route', async () => {
    ctx = buildTestServer();
    expect((await request(ctx.app).get('/api/clipboard')).status).toBe(401);
    expect((await request(ctx.app).post('/api/clipboard').send({})).status).toBe(401);
    expect((await request(ctx.app).delete('/api/clipboard/x')).status).toBe(401);
    expect((await request(ctx.app).delete('/api/clipboard')).status).toBe(401);
  });

  it('adds an item and lists it newest first', async () => {
    ctx = buildTestServer();
    const { deviceId, keys } = await pairFirstDevice(ctx.app);
    const body = Buffer.from(JSON.stringify({ contentType: 'text/plain', ciphertext: 'abc' }));
    const postRes = await request(ctx.app)
      .post('/api/clipboard')
      .set(authed(keys, deviceId, 'POST', '/api/clipboard', body))
      .send(JSON.parse(body.toString()));
    expect(postRes.status).toBe(201);

    const getRes = await request(ctx.app)
      .get('/api/clipboard')
      .set(authed(keys, deviceId, 'GET', '/api/clipboard'));
    expect(getRes.status).toBe(200);
    expect(getRes.body.items).toHaveLength(1);
    expect(getRes.body.items[0].deviceId).toBe(deviceId);
  });

  it('deletes a single item', async () => {
    ctx = buildTestServer();
    const { deviceId, keys } = await pairFirstDevice(ctx.app);
    const body = Buffer.from(JSON.stringify({ contentType: 'text/plain', ciphertext: 'abc' }));
    const postRes = await request(ctx.app)
      .post('/api/clipboard')
      .set(authed(keys, deviceId, 'POST', '/api/clipboard', body))
      .send(JSON.parse(body.toString()));
    const id = postRes.body.id;

    const delRes = await request(ctx.app)
      .delete(`/api/clipboard/${id}`)
      .set(authed(keys, deviceId, 'DELETE', `/api/clipboard/${id}`));
    expect(delRes.status).toBe(204);

    const getRes = await request(ctx.app)
      .get('/api/clipboard')
      .set(authed(keys, deviceId, 'GET', '/api/clipboard'));
    expect(getRes.body.items).toHaveLength(0);
  });

  it('clears all items', async () => {
    ctx = buildTestServer();
    const { deviceId, keys } = await pairFirstDevice(ctx.app);
    for (const text of ['a', 'b']) {
      const body = Buffer.from(JSON.stringify({ contentType: 'text/plain', ciphertext: text }));
      await request(ctx.app)
        .post('/api/clipboard')
        .set(authed(keys, deviceId, 'POST', '/api/clipboard', body))
        .send(JSON.parse(body.toString()));
    }
    const clearRes = await request(ctx.app)
      .delete('/api/clipboard')
      .set(authed(keys, deviceId, 'DELETE', '/api/clipboard'));
    expect(clearRes.status).toBe(204);

    const getRes = await request(ctx.app)
      .get('/api/clipboard')
      .set(authed(keys, deviceId, 'GET', '/api/clipboard'));
    expect(getRes.body.items).toHaveLength(0);
  });

  it('evicts the oldest item once more than 50 are stored', async () => {
    ctx = buildTestServer();
    const { deviceId, keys } = await pairFirstDevice(ctx.app);
    for (let i = 0; i < 51; i++) {
      const body = Buffer.from(JSON.stringify({ contentType: 'text/plain', ciphertext: `item-${i}` }));
      await request(ctx.app)
        .post('/api/clipboard')
        .set(authed(keys, deviceId, 'POST', '/api/clipboard', body))
        .send(JSON.parse(body.toString()));
    }
    const getRes = await request(ctx.app)
      .get('/api/clipboard')
      .set(authed(keys, deviceId, 'GET', '/api/clipboard'));
    expect(getRes.body.items).toHaveLength(50);
    const ciphertexts = getRes.body.items.map((i: any) => i.ciphertext);
    expect(ciphertexts).not.toContain('item-0');
    expect(ciphertexts).toContain('item-50');
  });
});
