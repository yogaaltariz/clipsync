// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { generateDeviceKeys, exportPublicJwk } from './deviceIdentity.js';
import { decryptContent, deriveSharedKey, encryptContent } from './contentCrypto.js';

describe('deriveSharedKey + encryptContent + decryptContent', () => {
  it('two devices independently derive the same key from each other\'s public exchange key', async () => {
    const alice = await generateDeviceKeys();
    const bob = await generateDeviceKeys();

    const alicePublicJwk = await exportPublicJwk(alice.exchangeKeyPair.publicKey);
    const bobPublicJwk = await exportPublicJwk(bob.exchangeKeyPair.publicKey);

    const aliceSharedKey = await deriveSharedKey(alice.exchangeKeyPair.privateKey, bobPublicJwk);
    const bobSharedKey = await deriveSharedKey(bob.exchangeKeyPair.privateKey, alicePublicJwk);

    // Prove they're the same key by using one to encrypt and the other to
    // decrypt, rather than trying to compare CryptoKey objects directly.
    const ciphertext = await encryptContent(aliceSharedKey, 'docker compose up -d');
    const plaintext = await decryptContent(bobSharedKey, ciphertext);
    expect(plaintext).toBe('docker compose up -d');
  });

  it('produces different ciphertext for the same plaintext on each call (random IV)', async () => {
    const alice = await generateDeviceKeys();
    const bob = await generateDeviceKeys();
    const sharedKey = await deriveSharedKey(alice.exchangeKeyPair.privateKey, await exportPublicJwk(bob.exchangeKeyPair.publicKey));

    const first = await encryptContent(sharedKey, 'hello');
    const second = await encryptContent(sharedKey, 'hello');
    expect(first).not.toBe(second);
  });

  it('fails to decrypt with a key derived from a different peer pairing', async () => {
    const alice = await generateDeviceKeys();
    const bob = await generateDeviceKeys();
    const mallory = await generateDeviceKeys();

    const aliceBobKey = await deriveSharedKey(alice.exchangeKeyPair.privateKey, await exportPublicJwk(bob.exchangeKeyPair.publicKey));
    const aliceMalloryKey = await deriveSharedKey(alice.exchangeKeyPair.privateKey, await exportPublicJwk(mallory.exchangeKeyPair.publicKey));

    const ciphertext = await encryptContent(aliceBobKey, 'secret code 482913');
    await expect(decryptContent(aliceMalloryKey, ciphertext)).rejects.toThrow();
  });

  it('round-trips non-ASCII text correctly', async () => {
    const alice = await generateDeviceKeys();
    const bob = await generateDeviceKeys();
    const key = await deriveSharedKey(alice.exchangeKeyPair.privateKey, await exportPublicJwk(bob.exchangeKeyPair.publicKey));

    const original = 'emoji test 🔒 and ünïcödé';
    const ciphertext = await encryptContent(key, original);
    expect(await decryptContent(key, ciphertext)).toBe(original);
  });
});
