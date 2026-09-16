import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { buildTestServer } from './helpers/testServer.js';
import { generateDeviceKeys, signRequest } from './helpers/testKeys.js';

async function waitFor(predicate: () => boolean, timeoutMs = 1000, intervalMs = 10): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return predicate();
}

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

  it('rejects oversized uploads with 413 without auth', async () => {
    ctx = buildTestServer();
    const oversizedBuffer = Buffer.alloc(11 * 1024 * 1024); // 11 MB
    const res = await request(ctx.app)
      .post('/api/clipboard/some-id/blob')
      .attach('file', oversizedBuffer, 'huge.png');
    expect(res.status).toBe(413);
    expect(res.body.error).toBe('file_too_large');
    expect(JSON.stringify(res.body)).not.toContain('Error');
  });

  it('deletes the blob file from disk when its clipboard item is deleted', async () => {
    ctx = buildTestServer();
    const { deviceId, keys } = await pairFirstDevice(ctx.app);

    const createBody = Buffer.from(JSON.stringify({ contentType: 'image/png', ciphertext: 'placeholder' }));
    const createHeaders = signRequest(keys.privateKeyAuth, 'POST', '/api/clipboard', createBody);
    createHeaders['X-ClipSync-Device-Id'] = deviceId;
    const created = await request(ctx.app).post('/api/clipboard').set(createHeaders).send(JSON.parse(createBody.toString()));
    const itemId = created.body.id;

    const fileBytes = Buffer.from('fake-encrypted-png-bytes-for-deletion-check');
    const uploadPath = `/api/clipboard/${itemId}/blob`;
    const uploadHeaders = signRequest(keys.privateKeyAuth, 'POST', uploadPath, fileBytes);
    uploadHeaders['X-ClipSync-Device-Id'] = deviceId;
    const uploadRes = await request(ctx.app).post(uploadPath).set(uploadHeaders).attach('file', fileBytes, 'clip.png');
    expect(uploadRes.status).toBe(200);

    const blobPath = uploadRes.body.blobPath as string;
    expect(blobPath).toBeTypeOf('string');
    const absoluteBlobPath = path.join(ctx.blobDir, blobPath);
    expect(fs.existsSync(absoluteBlobPath)).toBe(true);

    const deleteHeaders = signRequest(keys.privateKeyAuth, 'DELETE', `/api/clipboard/${itemId}`);
    deleteHeaders['X-ClipSync-Device-Id'] = deviceId;
    const deleteRes = await request(ctx.app).delete(`/api/clipboard/${itemId}`).set(deleteHeaders);
    expect(deleteRes.status).toBe(204);

    // Blob deletion is fire-and-forget (not awaited by the request handler), so poll
    // briefly rather than asserting immediately.
    const gone = await waitFor(() => !fs.existsSync(absoluteBlobPath));
    expect(gone).toBe(true);
  });

  it('requires authentication for GET /:id/blob', async () => {
    ctx = buildTestServer();
    const { deviceId, keys } = await pairFirstDevice(ctx.app);

    const createBody = Buffer.from(JSON.stringify({ contentType: 'image/png', ciphertext: 'placeholder' }));
    const createHeaders = signRequest(keys.privateKeyAuth, 'POST', '/api/clipboard', createBody);
    createHeaders['X-ClipSync-Device-Id'] = deviceId;
    const created = await request(ctx.app).post('/api/clipboard').set(createHeaders).send(JSON.parse(createBody.toString()));
    const itemId = created.body.id;

    const fileBytes = Buffer.from('fake-encrypted-png-bytes-for-auth-check');
    const uploadPath = `/api/clipboard/${itemId}/blob`;
    const uploadHeaders = signRequest(keys.privateKeyAuth, 'POST', uploadPath, fileBytes);
    uploadHeaders['X-ClipSync-Device-Id'] = deviceId;
    const uploadRes = await request(ctx.app).post(uploadPath).set(uploadHeaders).attach('file', fileBytes, 'clip.png');
    expect(uploadRes.status).toBe(200);

    // No auth headers at all on the download request.
    const res = await request(ctx.app).get(`/api/clipboard/${itemId}/blob`);
    expect(res.status).toBe(401);
  });
});
