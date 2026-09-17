#!/usr/bin/env node
// Manually exercise the ClipSync core server end to end: pair a device,
// add a clipboard item, list it back. Requires the server already running
// (npm run dev, from apps/clipsync-server/), and Node 20+ for global fetch.
//
// Usage: node scripts/demo.mjs [baseUrl]
//   node scripts/demo.mjs                       # defaults to http://127.0.0.1:3000
//   node scripts/demo.mjs http://192.168.1.20:3000

import { generateKeyPairSync, sign, createHash } from 'node:crypto';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:3000';

function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

function buildCanonical(method, path, ts, bodyHashHex) {
  return `${method.toUpperCase()}\n${path}\n${ts}\n${bodyHashHex}`;
}

function signRequest(privateKey, method, path, bodyBuffer = Buffer.alloc(0)) {
  const ts = String(Date.now());
  const canonical = buildCanonical(method, path, ts, sha256Hex(bodyBuffer));
  const signature = sign(null, Buffer.from(canonical), privateKey).toString('base64');
  return { 'X-ClipSync-Timestamp': ts, 'X-ClipSync-Signature': signature };
}

async function main() {
  console.log(`Testing ClipSync server at ${baseUrl}\n`);

  const health = await fetch(`${baseUrl}/healthz`);
  console.log('GET  /healthz              ->', health.status, JSON.stringify(await health.json()));

  // This script's own device identity — a fresh Ed25519/X25519 keypair,
  // exactly what a real client would generate on first launch.
  const auth = generateKeyPairSync('ed25519');
  const exchange = generateKeyPairSync('x25519');
  const publicKeyAuthJwk = JSON.stringify(auth.publicKey.export({ format: 'jwk' }));
  const publicKeyExchangeJwk = JSON.stringify(exchange.publicKey.export({ format: 'jwk' }));

  // Bootstrap pairing only succeeds unauthenticated if this is the very
  // first device on this server (PRODUCT.md: 1 Mac + 1 Android max).
  const startRes = await fetch(`${baseUrl}/api/pairing/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initiatorDeviceName: 'demo-script' }),
  });
  const startBody = await startRes.json();
  console.log('POST /api/pairing/start    ->', startRes.status, JSON.stringify(startBody));

  if (startRes.status !== 200) {
    console.log(
      '\nNon-200 here usually means a device is already paired on this server\n' +
        '(this script only bootstrap-pairs the FIRST device — it has no way to\n' +
        'authenticate as an already-paired one). Use a fresh CLIPSYNC_DATA_DIR\n' +
        'or clear the existing data/clipsync.db to retry from a clean slate.',
    );
    return;
  }

  const completeRes = await fetch(`${baseUrl}/api/pairing/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: startBody.token,
      deviceName: 'demo-script',
      publicKeyAuthJwk,
      publicKeyExchangeJwk,
    }),
  });
  const completeBody = await completeRes.json();
  console.log('POST /api/pairing/complete ->', completeRes.status, JSON.stringify(completeBody));
  const deviceId = completeBody.deviceId;

  const itemBodyBuf = Buffer.from(
    JSON.stringify({ contentType: 'text/plain', ciphertext: 'hello from the demo script' }),
  );
  const addHeaders = signRequest(auth.privateKey, 'POST', '/api/clipboard', itemBodyBuf);
  const addRes = await fetch(`${baseUrl}/api/clipboard`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-ClipSync-Device-Id': deviceId,
      ...addHeaders,
    },
    body: itemBodyBuf,
  });
  console.log('POST /api/clipboard        ->', addRes.status, JSON.stringify(await addRes.json()));

  const listHeaders = signRequest(auth.privateKey, 'GET', '/api/clipboard');
  const listRes = await fetch(`${baseUrl}/api/clipboard`, {
    headers: { 'X-ClipSync-Device-Id': deviceId, ...listHeaders },
  });
  console.log('GET  /api/clipboard        ->', listRes.status, JSON.stringify(await listRes.json()));

  console.log(
    '\nDone. This device is now permanently paired on this server (until you\n' +
      'unpair it via DELETE /api/pairing/devices/:deviceId). Re-running this\n' +
      'script will fail at pairing/start, since the 2-device cap is already at 1\n' +
      'and this script has no stored identity to re-authenticate with — that\n' +
      "part's expected; a real client persists its keys across launches.",
  );
}

main().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});
