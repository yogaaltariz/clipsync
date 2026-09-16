import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { buildCanonicalString, sha256Hex, verifySignature } from '../src/crypto/signatures.js';

function keypairJwk() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicJwk: JSON.stringify(publicKey.export({ format: 'jwk' })),
    privateKeyObj: privateKey,
  };
}

describe('buildCanonicalString', () => {
  it('joins method, path, timestamp, and body hash with newlines', () => {
    expect(buildCanonicalString('GET', '/api/clipboard', '1700000000000', 'deadbeef')).toBe(
      'GET\n/api/clipboard\n1700000000000\ndeadbeef',
    );
  });
});

describe('sha256Hex', () => {
  it('hashes an empty buffer to the known SHA-256 constant', () => {
    expect(sha256Hex(Buffer.alloc(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('verifySignature', () => {
  it('accepts a signature produced by the matching private key', () => {
    const { publicJwk, privateKeyObj } = keypairJwk();
    const canonical = buildCanonicalString('GET', '/api/clipboard', '1700000000000', sha256Hex(''));
    const signature = sign(null, Buffer.from(canonical), privateKeyObj).toString('base64');
    expect(verifySignature(publicJwk, canonical, signature)).toBe(true);
  });

  it('rejects a signature from a different key', () => {
    const { publicJwk } = keypairJwk();
    const other = generateKeyPairSync('ed25519');
    const canonical = buildCanonicalString('GET', '/api/clipboard', '1700000000000', sha256Hex(''));
    const wrongSignature = sign(null, Buffer.from(canonical), other.privateKey).toString('base64');
    expect(verifySignature(publicJwk, canonical, wrongSignature)).toBe(false);
  });

  it('rejects a signature over a tampered canonical string', () => {
    const { publicJwk, privateKeyObj } = keypairJwk();
    const original = buildCanonicalString('GET', '/api/clipboard', '1700000000000', sha256Hex(''));
    const tampered = buildCanonicalString('DELETE', '/api/clipboard', '1700000000000', sha256Hex(''));
    const signature = sign(null, Buffer.from(original), privateKeyObj).toString('base64');
    expect(verifySignature(publicJwk, tampered, signature)).toBe(false);
  });
});
