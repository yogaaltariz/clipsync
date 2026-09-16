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
