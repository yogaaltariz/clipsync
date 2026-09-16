import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';

export function buildCanonicalString(
  method: string,
  path: string,
  timestampMs: string,
  bodyHashHex: string,
): string {
  return `${method.toUpperCase()}\n${path}\n${timestampMs}\n${bodyHashHex}`;
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function verifySignature(
  publicKeyAuthJwk: string,
  canonical: string,
  signatureB64: string,
): boolean {
  try {
    const jwk = JSON.parse(publicKeyAuthJwk);
    const keyObject = createPublicKey({ key: jwk, format: 'jwk' });
    const signature = Buffer.from(signatureB64, 'base64');
    return cryptoVerify(null, Buffer.from(canonical), keyObject, signature);
  } catch {
    return false;
  }
}
