// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateDeviceKeys } from './deviceIdentity.js';
import { createApiClient } from './apiClient.js';

describe('createApiClient', () => {
  let authPrivateKey: CryptoKey;
  const deviceId = 'device-under-test';
  const baseUrl = 'https://clipsync.local:3000';

  beforeEach(async () => {
    const keys = await generateDeviceKeys();
    authPrivateKey = keys.authKeyPair.privateKey;
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetchOnce(status: number, body: unknown) {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    });
  }

  it('signs GET /api/clipboard with the three required headers and no body', async () => {
    mockFetchOnce(200, { items: [] });
    const client = createApiClient({ baseUrl, deviceId, authPrivateKey });
    const result = await client.listClipboard();

    expect(result).toEqual({ items: [] });
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${baseUrl}/api/clipboard`);
    expect(init.method).toBe('GET');
    expect(init.headers['X-ClipSync-Device-Id']).toBe(deviceId);
    expect(typeof init.headers['X-ClipSync-Timestamp']).toBe('string');
    expect(typeof init.headers['X-ClipSync-Signature']).toBe('string');
  });

  it('signs POST /api/clipboard over the actual JSON body bytes', async () => {
    mockFetchOnce(201, { id: 'item-1', contentType: 'text/plain', ciphertext: 'abc' });
    const client = createApiClient({ baseUrl, deviceId, authPrivateKey });
    await client.addClipboardItem({ contentType: 'text/plain', ciphertext: 'abc' });

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${baseUrl}/api/clipboard`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ contentType: 'text/plain', ciphertext: 'abc' });
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('calls DELETE /api/clipboard/:id with the id in the path', async () => {
    mockFetchOnce(204, undefined);
    const client = createApiClient({ baseUrl, deviceId, authPrivateKey });
    await client.deleteClipboardItem('item-42');
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${baseUrl}/api/clipboard/item-42`);
    expect(init.method).toBe('DELETE');
  });

  it('calls DELETE /api/clipboard with no id for clearClipboard', async () => {
    mockFetchOnce(204, undefined);
    const client = createApiClient({ baseUrl, deviceId, authPrivateKey });
    await client.clearClipboard();
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${baseUrl}/api/clipboard`);
    expect(init.method).toBe('DELETE');
  });

  it('calls DELETE /api/pairing/devices/:deviceId for unpairDevice', async () => {
    mockFetchOnce(204, undefined);
    const client = createApiClient({ baseUrl, deviceId, authPrivateKey });
    await client.unpairDevice('other-device-id');
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${baseUrl}/api/pairing/devices/other-device-id`);
    expect(init.method).toBe('DELETE');
  });

  it('pairingStart sends no auth headers when authed=false (bootstrap)', async () => {
    mockFetchOnce(200, { token: 'tok', expiresAt: '2026-01-01T00:00:00.000Z' });
    const client = createApiClient({ baseUrl, deviceId, authPrivateKey });
    await client.pairingStart("Yoga's Mac", false);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${baseUrl}/api/pairing/start`);
    expect(init.headers['X-ClipSync-Device-Id']).toBeUndefined();
  });

  it('pairingStart signs the request when authed=true', async () => {
    mockFetchOnce(200, { token: 'tok', expiresAt: '2026-01-01T00:00:00.000Z' });
    const client = createApiClient({ baseUrl, deviceId, authPrivateKey });
    await client.pairingStart("Yoga's Mac", true);
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers['X-ClipSync-Device-Id']).toBe(deviceId);
  });

  it('pairingComplete posts to /api/pairing/complete unauthenticated with the given fields', async () => {
    mockFetchOnce(200, { deviceId: 'new-device', peerDevices: [] });
    const client = createApiClient({ baseUrl, deviceId, authPrivateKey });
    const result = await client.pairingComplete({
      token: 'tok',
      deviceName: 'Pixel',
      publicKeyAuthJwk: '{}',
      publicKeyExchangeJwk: '{}',
    });
    expect(result).toEqual({ deviceId: 'new-device', peerDevices: [] });
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${baseUrl}/api/pairing/complete`);
    expect(init.headers['X-ClipSync-Device-Id']).toBeUndefined();
  });

  it('throws with the server-provided error code when a request fails', async () => {
    mockFetchOnce(409, { error: 'max_paired_devices' });
    const client = createApiClient({ baseUrl, deviceId, authPrivateKey });
    await expect(client.pairingStart('x', false)).rejects.toThrow('max_paired_devices');
  });

  it('uploadBlob posts multipart form data to /api/clipboard/:id/blob', async () => {
    mockFetchOnce(200, { id: 'item-1', contentType: 'image/png', blobPath: 'item-1.bin' });
    const client = createApiClient({ baseUrl, deviceId, authPrivateKey });
    const fakeBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    await client.uploadBlob('item-1', fakeBlob);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${baseUrl}/api/clipboard/item-1/blob`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers['X-ClipSync-Device-Id']).toBe(deviceId);
  });

  it('downloadBlob GETs /api/clipboard/:id/blob and returns a Blob', async () => {
    const fakeBlob = new Blob(['fake-bytes']);
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      ok: true,
      blob: async () => fakeBlob,
    });
    const client = createApiClient({ baseUrl, deviceId, authPrivateKey });
    const result = await client.downloadBlob('item-1');
    expect(result).toBe(fakeBlob);
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${baseUrl}/api/clipboard/item-1/blob`);
  });

  it('deleteClipboardItem throws with server error code from response body', async () => {
    mockFetchOnce(404, { error: 'not_found' });
    const client = createApiClient({ baseUrl, deviceId, authPrivateKey });
    await expect(client.deleteClipboardItem('item-missing')).rejects.toThrow('not_found');
  });
});
