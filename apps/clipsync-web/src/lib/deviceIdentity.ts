import { get, set, del } from 'idb-keyval';

export interface DeviceIdentity {
  deviceId: string;
  authKeyPair: CryptoKeyPair;
  exchangeKeyPair: CryptoKeyPair;
}

const STORAGE_KEY = 'clipsync-device-identity';

export async function generateDeviceKeys(): Promise<{
  authKeyPair: CryptoKeyPair;
  exchangeKeyPair: CryptoKeyPair;
}> {
  const authKeyPair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const exchangeKeyPair = (await crypto.subtle.generateKey({ name: 'X25519' }, false, [
    'deriveBits',
  ])) as CryptoKeyPair;
  return { authKeyPair, exchangeKeyPair };
}

export async function exportPublicJwk(key: CryptoKey): Promise<string> {
  const jwk = await crypto.subtle.exportKey('jwk', key);
  return JSON.stringify(jwk);
}

export async function saveDeviceIdentity(identity: DeviceIdentity): Promise<void> {
  // Public keys must be marked extractable to store/re-export them freely;
  // private keys stay non-extractable throughout — IndexedDB's structured
  // clone algorithm can store a non-extractable CryptoKey directly, it just
  // can never be exported to raw bytes by any code, including this app's.
  await set(STORAGE_KEY, {
    deviceId: identity.deviceId,
    authPrivateKey: identity.authKeyPair.privateKey,
    authPublicKey: identity.authKeyPair.publicKey,
    exchangePrivateKey: identity.exchangeKeyPair.privateKey,
    exchangePublicKey: identity.exchangeKeyPair.publicKey,
  });
}

export async function loadDeviceIdentity(): Promise<DeviceIdentity | null> {
  const stored = await get<{
    deviceId: string;
    authPrivateKey: CryptoKey;
    authPublicKey: CryptoKey;
    exchangePrivateKey: CryptoKey;
    exchangePublicKey: CryptoKey;
  }>(STORAGE_KEY);
  if (!stored) return null;
  return {
    deviceId: stored.deviceId,
    authKeyPair: { privateKey: stored.authPrivateKey, publicKey: stored.authPublicKey },
    exchangeKeyPair: { privateKey: stored.exchangePrivateKey, publicKey: stored.exchangePublicKey },
  };
}

export async function clearDeviceIdentity(): Promise<void> {
  await del(STORAGE_KEY);
}
