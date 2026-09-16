// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildCanonicalString, sha256Hex } from './signing.js';

describe('sha256Hex', () => {
  it('hashes an empty string to the known SHA-256 constant', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('hashes an ArrayBuffer the same way as the equivalent string', async () => {
    const bytes = new TextEncoder().encode('hello');
    expect(await sha256Hex(bytes.buffer)).toBe(await sha256Hex('hello'));
  });
});

describe('buildCanonicalString', () => {
  it('joins method, path, timestamp, and body hash with newlines', () => {
    expect(buildCanonicalString('GET', '/api/clipboard', '1700000000000', 'deadbeef')).toBe(
      'GET\n/api/clipboard\n1700000000000\ndeadbeef',
    );
  });

  it('uppercases the method', () => {
    expect(buildCanonicalString('get', '/x', '1', 'h')).toBe('GET\n/x\n1\nh');
  });
});

describe('WebCrypto capability check (this test IS the capability check)', () => {
  it('can generate, sign, and verify with Ed25519', async () => {
    const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const data = new TextEncoder().encode('test message');
    const signature = await crypto.subtle.sign({ name: 'Ed25519' }, keyPair.privateKey, data);
    const valid = await crypto.subtle.verify({ name: 'Ed25519' }, keyPair.publicKey, signature, data);
    expect(valid).toBe(true);
  });

  it('can generate an X25519 key pair and derive matching shared bits between two parties', async () => {
    const alice = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
    const bob = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
    const aliceShared = await crypto.subtle.deriveBits(
      { name: 'X25519', public: bob.publicKey },
      alice.privateKey,
      256,
    );
    const bobShared = await crypto.subtle.deriveBits(
      { name: 'X25519', public: alice.publicKey },
      bob.privateKey,
      256,
    );
    expect(new Uint8Array(aliceShared)).toEqual(new Uint8Array(bobShared));
  });

  it('can export an Ed25519 public key as JWK in the shape Node crypto.createPublicKey accepts', async () => {
    const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    expect(jwk.kty).toBe('OKP');
    expect(jwk.crv).toBe('Ed25519');
    expect(typeof jwk.x).toBe('string');
  });
});
