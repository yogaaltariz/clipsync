import { signRequest } from './signing.js';

export interface PeerDevice {
  deviceId: string;
  deviceName: string;
  publicKeyAuthJwk: string;
  publicKeyExchangeJwk: string;
  pairedAt: string;
  revokedAt: string | null;
}

export interface ClipboardItemDto {
  id: string;
  contentType: string;
  ciphertext: string | null;
  blobPath: string | null;
  deviceId: string;
  deviceName: string;
  createdAt: string;
}

export interface ApiClientConfig {
  baseUrl: string;
  deviceId: string;
  authPrivateKey: CryptoKey;
}

class ApiError extends Error {
  constructor(
    public status: number,
    errorCode: string,
  ) {
    super(errorCode);
    this.name = 'ApiError';
  }
}

export interface ApiClient {
  pairingStart(initiatorDeviceName: string, authed: boolean): Promise<{ token: string; expiresAt: string }>;
  pairingComplete(input: {
    token: string;
    deviceName: string;
    publicKeyAuthJwk: string;
    publicKeyExchangeJwk: string;
  }): Promise<{ deviceId: string; peerDevices: PeerDevice[] }>;
  listClipboard(): Promise<{ items: ClipboardItemDto[] }>;
  addClipboardItem(input: { contentType: string; ciphertext: string }): Promise<ClipboardItemDto>;
  deleteClipboardItem(id: string): Promise<void>;
  clearClipboard(): Promise<void>;
  unpairDevice(deviceId: string): Promise<void>;
  uploadBlob(itemId: string, file: Blob): Promise<ClipboardItemDto>;
  downloadBlob(itemId: string): Promise<Blob>;
}

export function createApiClient({ baseUrl, deviceId, authPrivateKey }: ApiClientConfig): ApiClient {
  async function authedHeaders(method: string, path: string, bodyBuffer?: ArrayBuffer) {
    const { timestamp, signature } = await signRequest(authPrivateKey, method, path, bodyBuffer);
    return {
      'X-ClipSync-Device-Id': deviceId,
      'X-ClipSync-Timestamp': timestamp,
      'X-ClipSync-Signature': signature,
    };
  }

  async function parseJsonOrThrow(res: Response) {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(res.status, (body as { error?: string }).error ?? `http_${res.status}`);
    }
    return body;
  }

  return {
    async pairingStart(initiatorDeviceName, authed) {
      const path = '/api/pairing/start';
      const bodyBuffer = new TextEncoder().encode(JSON.stringify({ initiatorDeviceName })).buffer as ArrayBuffer;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authed) Object.assign(headers, await authedHeaders('POST', path, bodyBuffer));
      const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify({ initiatorDeviceName }) });
      return parseJsonOrThrow(res);
    },

    async pairingComplete(input) {
      const path = '/api/pairing/complete';
      const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      return parseJsonOrThrow(res);
    },

    async listClipboard() {
      const path = '/api/clipboard';
      const headers = await authedHeaders('GET', path);
      const res = await fetch(`${baseUrl}${path}`, { method: 'GET', headers });
      return parseJsonOrThrow(res);
    },

    async addClipboardItem(input) {
      const path = '/api/clipboard';
      const bodyBuffer = new TextEncoder().encode(JSON.stringify(input)).buffer as ArrayBuffer;
      const headers = { 'Content-Type': 'application/json', ...(await authedHeaders('POST', path, bodyBuffer)) };
      const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(input) });
      return parseJsonOrThrow(res);
    },

    async deleteClipboardItem(id) {
      const path = `/api/clipboard/${id}`;
      const headers = await authedHeaders('DELETE', path);
      const res = await fetch(`${baseUrl}${path}`, { method: 'DELETE', headers });
      if (!res.ok) throw new ApiError(res.status, `http_${res.status}`);
    },

    async clearClipboard() {
      const path = '/api/clipboard';
      const headers = await authedHeaders('DELETE', path);
      const res = await fetch(`${baseUrl}${path}`, { method: 'DELETE', headers });
      if (!res.ok) throw new ApiError(res.status, `http_${res.status}`);
    },

    async unpairDevice(targetDeviceId) {
      const path = `/api/pairing/devices/${targetDeviceId}`;
      const headers = await authedHeaders('DELETE', path);
      const res = await fetch(`${baseUrl}${path}`, { method: 'DELETE', headers });
      if (!res.ok) throw new ApiError(res.status, `http_${res.status}`);
    },

    async uploadBlob(itemId, file) {
      const path = `/api/clipboard/${itemId}/blob`;
      const fileBuffer = await file.arrayBuffer();
      const headers = await authedHeaders('POST', path, fileBuffer);
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: formData });
      return parseJsonOrThrow(res);
    },

    async downloadBlob(itemId) {
      const path = `/api/clipboard/${itemId}/blob`;
      const headers = await authedHeaders('GET', path);
      const res = await fetch(`${baseUrl}${path}`, { method: 'GET', headers });
      if (!res.ok) throw new ApiError(res.status, `http_${res.status}`);
      return res.blob();
    },
  };
}
