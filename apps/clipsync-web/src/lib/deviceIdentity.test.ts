// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { set } from 'idb-keyval';
import {
  clearDeviceIdentity,
  exportPublicJwk,
  generateDeviceKeys,
  loadDeviceIdentity,
  saveDeviceIdentity,
} from './deviceIdentity.js';

describe('generateDeviceKeys', () => {
  it('produces a non-extractable Ed25519 auth pair and X25519 exchange pair', async () => {
    const { authKeyPair, exchangeKeyPair } = await generateDeviceKeys();
    expect(authKeyPair.privateKey.algorithm.name).toBe('Ed25519');
    expect(authKeyPair.privateKey.extractable).toBe(false);
    expect(exchangeKeyPair.privateKey.algorithm.name).toBe('X25519');
    expect(exchangeKeyPair.privateKey.extractable).toBe(false);
  });
});

describe('exportPublicJwk', () => {
  it('exports a public key as a JSON string with the expected JWK shape', async () => {
    const { authKeyPair } = await generateDeviceKeys();
    const jwkString = await exportPublicJwk(authKeyPair.publicKey);
    const jwk = JSON.parse(jwkString);
    expect(jwk.kty).toBe('OKP');
    expect(jwk.crv).toBe('Ed25519');
  });
});

describe('saveDeviceIdentity / loadDeviceIdentity round trip', () => {
  afterEach(async () => {
    await clearDeviceIdentity();
  });

  it('returns null when nothing has been saved yet', async () => {
    expect(await loadDeviceIdentity()).toBeNull();
  });

  it('persists and reloads an identity, preserving usable (non-extractable) keys', async () => {
    const { authKeyPair, exchangeKeyPair } = await generateDeviceKeys();
    const deviceId = 'device-abc-123';
    await saveDeviceIdentity({ deviceId, authKeyPair, exchangeKeyPair });

    const loaded = await loadDeviceIdentity();
    expect(loaded).not.toBeNull();
    expect(loaded!.deviceId).toBe(deviceId);

    // Prove the reloaded private key is still usable for its real purpose,
    // not just structurally present.
    const data = new TextEncoder().encode('round trip check');
    const signature = await crypto.subtle.sign({ name: 'Ed25519' }, loaded!.authKeyPair.privateKey, data);
    const valid = await crypto.subtle.verify({ name: 'Ed25519' }, loaded!.authKeyPair.publicKey, signature, data);
    expect(valid).toBe(true);
  });

  it('clearDeviceIdentity removes the saved identity', async () => {
    const { authKeyPair, exchangeKeyPair } = await generateDeviceKeys();
    await saveDeviceIdentity({ deviceId: 'device-to-clear', authKeyPair, exchangeKeyPair });
    await clearDeviceIdentity();
    expect(await loadDeviceIdentity()).toBeNull();
  });

  it('returns null and clears corrupted/incomplete records instead of returning a broken object', async () => {
    // Simulate a schema change or corruption by writing a partial record directly
    await set('clipsync-device-identity', {
      deviceId: 'corrupted-device',
      // Missing authPrivateKey, authPublicKey, exchangePrivateKey, exchangePublicKey
    });

    // loadDeviceIdentity should detect the missing fields and return null
    const loaded = await loadDeviceIdentity();
    expect(loaded).toBeNull();

    // The corrupted record should have been cleared
    const reloaded = await loadDeviceIdentity();
    expect(reloaded).toBeNull();
  });
});
