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

describe('image upload and download', () => {
  let ctx: ReturnType<typeof buildTestServer>;
  afterEach(() => ctx?.cleanup());

  it('uploads a blob for an existing item and downloads it back byte-for-byte', async () => {
    ctx = buildTestServer();
    const { deviceId, keys } = await pairFirstDevice(ctx.app);

    const createBody = Buffer.from(JSON.stringify({ contentType: 'image/png', ciphertext: 'placeholder' }));
    const createHeaders = signRequest(keys.privateKeyAuth, 'POST', '/api/clipboard', createBody);
    createHeaders['X-ClipSync-Device-Id'] = deviceId;
    const created = await request(ctx.app).post('/api/clipboard').set(createHeaders).send(JSON.parse(createBody.toString()));
    const itemId = created.body.id;

    const fileBytes = Buffer.from('fake-encrypted-png-bytes');
    const uploadPath = `/api/clipboard/${itemId}/blob`;
    const uploadHeaders = signRequest(keys.privateKeyAuth, 'POST', uploadPath, fileBytes);
    uploadHeaders['X-ClipSync-Device-Id'] = deviceId;
    const uploadRes = await request(ctx.app)
      .post(uploadPath)
      .set(uploadHeaders)
      .attach('file', fileBytes, 'clip.png');
    expect(uploadRes.status).toBe(200);

    const downloadPath = `/api/clipboard/${itemId}/blob`;
    const downloadHeaders = signRequest(keys.privateKeyAuth, 'GET', downloadPath);
    downloadHeaders['X-ClipSync-Device-Id'] = deviceId;
    const downloadRes = await request(ctx.app).get(downloadPath).set(downloadHeaders);
    expect(downloadRes.status).toBe(200);
    expect(Buffer.compare(downloadRes.body, fileBytes)).toBe(0);
  });

  it('returns 404 downloading a blob for an item with none', async () => {
    ctx = buildTestServer();
    const { deviceId, keys } = await pairFirstDevice(ctx.app);
    const createBody = Buffer.from(JSON.stringify({ contentType: 'text/plain', ciphertext: 'no-blob-here' }));
    const createHeaders = signRequest(keys.privateKeyAuth, 'POST', '/api/clipboard', createBody);
    createHeaders['X-ClipSync-Device-Id'] = deviceId;
    const created = await request(ctx.app).post('/api/clipboard').set(createHeaders).send(JSON.parse(createBody.toString()));

    const downloadPath = `/api/clipboard/${created.body.id}/blob`;
    const downloadHeaders = signRequest(keys.privateKeyAuth, 'GET', downloadPath);
    downloadHeaders['X-ClipSync-Device-Id'] = deviceId;
    const res = await request(ctx.app).get(downloadPath).set(downloadHeaders);
    expect(res.status).toBe(404);
  });

  it('rejects an unauthenticated upload', async () => {
    ctx = buildTestServer();
    const res = await request(ctx.app).post('/api/clipboard/some-id/blob').attach('file', Buffer.from('x'), 'x.png');
    expect(res.status).toBe(401);
  });
});
