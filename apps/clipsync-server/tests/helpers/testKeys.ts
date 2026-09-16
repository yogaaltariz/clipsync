import { generateKeyPairSync, sign } from 'node:crypto';
import { buildCanonicalString, sha256Hex } from '../../src/crypto/signatures.js';

export function generateDeviceKeys() {
  const auth = generateKeyPairSync('ed25519');
  const exchange = generateKeyPairSync('x25519');
  return {
    publicKeyAuthJwk: JSON.stringify(auth.publicKey.export({ format: 'jwk' })),
    privateKeyAuth: auth.privateKey,
    publicKeyExchangeJwk: JSON.stringify(exchange.publicKey.export({ format: 'jwk' })),
  };
}

export function signRequest(
  privateKeyAuth: ReturnType<typeof generateKeyPairSync>['privateKey'],
  method: string,
  path: string,
  bodyBuffer: Buffer = Buffer.alloc(0),
  timestampMs: string = String(Date.now()),
) {
  const canonical = buildCanonicalString(method, path, timestampMs, sha256Hex(bodyBuffer));
  const signature = sign(null, Buffer.from(canonical), privateKeyAuth).toString('base64');
  return {
    'X-ClipSync-Device-Id': '', // caller fills in after registering the device
    'X-ClipSync-Timestamp': timestampMs,
    'X-ClipSync-Signature': signature,
  };
}
