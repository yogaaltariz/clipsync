export interface Device {
  deviceId: string;
  deviceName: string;
  publicKeyAuthJwk: string;
  publicKeyExchangeJwk: string;
  pairedAt: string;
  revokedAt: string | null;
}

export interface PairingSession {
  token: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  initiatorDeviceName: string;
}

export interface ClipboardItem {
  id: string;
  contentType: string;
  ciphertext: string | null;
  blobPath: string | null;
  deviceId: string;
  deviceName: string;
  createdAt: string;
}

export type ClipboardEvent =
  | { type: 'clipboard.created'; item: ClipboardItem }
  | { type: 'clipboard.deleted'; id: string }
  | { type: 'clipboard.cleared' };

export interface AuthedRequest {
  device: Device;
}
