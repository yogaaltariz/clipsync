
// 12-byte IV is the standard, recommended size for AES-GCM.
const IV_LENGTH_BYTES = 12;

export async function deriveSharedKey(
  myExchangePrivateKey: CryptoKey,
  peerExchangePublicKeyJwk: string,
): Promise<CryptoKey> {
  const peerPublicKey = await crypto.subtle.importKey(
    'jwk',
    JSON.parse(peerExchangePublicKeyJwk),
    { name: 'X25519' },
    false,
    [],
  );

  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'X25519', public: peerPublicKey },
    myExchangePrivateKey,
    256,
  );

  // HKDF over the raw ECDH output, no salt (both sides derive identically
  // without needing to exchange one) and a fixed, purpose-specific info
  // string so this key can never be confused with a key derived for a
  // different purpose from the same shared secret.
  const hkdfKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: new TextEncoder().encode('clipsync-content-encryption-v1'),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Decode(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encryptContent(sharedKey: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const ciphertextBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sharedKey, plaintextBytes);

  const combined = new Uint8Array(iv.length + ciphertextBuffer.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertextBuffer), iv.length);
  return base64Encode(combined);
}

export async function decryptContent(sharedKey: CryptoKey, encoded: string): Promise<string> {
  const combined = base64Decode(encoded);
  const iv = combined.slice(0, IV_LENGTH_BYTES);
  const ciphertext = combined.slice(IV_LENGTH_BYTES);
  const plaintextBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sharedKey, ciphertext);
  return new TextDecoder().decode(plaintextBuffer);
}
