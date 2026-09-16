export async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function buildCanonicalString(
  method: string,
  path: string,
  timestampMs: string,
  bodyHashHex: string,
): string {
  return `${method.toUpperCase()}\n${path}\n${timestampMs}\n${bodyHashHex}`;
}

function base64Encode(bytes: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export async function signRequest(
  authPrivateKey: CryptoKey,
  method: string,
  path: string,
  bodyBuffer: ArrayBuffer = new ArrayBuffer(0),
  timestampMs: string = String(Date.now()),
): Promise<{ timestamp: string; signature: string }> {
  const bodyHash = await sha256Hex(bodyBuffer);
  const canonical = buildCanonicalString(method, path, timestampMs, bodyHash);
  const signatureBytes = await crypto.subtle.sign(
    { name: 'Ed25519' },
    authPrivateKey,
    new TextEncoder().encode(canonical),
  );
  return { timestamp: timestampMs, signature: base64Encode(signatureBytes) };
}
