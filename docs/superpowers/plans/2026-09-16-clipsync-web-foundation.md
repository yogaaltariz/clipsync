# ClipSync Web Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the non-visual foundation of the ClipSync web client — device identity, request signing, the signed API client, the authenticated WebSocket client, and end-to-end content encryption — so the screens plan (written separately, once this is reviewed) has a real, tested layer to build on instead of hand-waving crypto and networking inside UI components.

**Architecture:** A set of small, framework-agnostic TypeScript modules under `apps/clipsync-web/src/lib/`, each with one responsibility, built directly on the browser's native WebCrypto API (`crypto.subtle`) and `fetch`/`WebSocket` — no crypto or HTTP libraries beyond `idb-keyval` for key persistence. Every module is designed to be consumed by React components later, but none of these tasks touch JSX or rendering — they are pure logic, tested directly. The signing scheme, canonical-string format, and every API route/WebSocket contract are copied verbatim from the already-shipped `clipsync-server` (in this same monorepo, at `apps/clipsync-server/`), so this plan does not invent a protocol — it implements the client side of one that already exists and is already tested.

**Tech Stack:** TypeScript 5, React 19 (not used by this plan's own code, but the target runtime), Vite 6 + Vitest 3, `idb-keyval` for IndexedDB key storage, the browser's native `crypto.subtle` for all cryptography (Ed25519 signing, X25519 key agreement, AES-GCM content encryption, SHA-256 hashing) — no polyfill unless Task 1 discovers one is needed.

**Spec:** `PRODUCT.md` and `PRD.md` at the monorepo root, plus the shipped backend contract at `apps/clipsync-server/src/routes/pairing.routes.ts`, `apps/clipsync-server/src/routes/clipboard.routes.ts`, `apps/clipsync-server/src/routes/uploads.routes.ts`, `apps/clipsync-server/src/server.ts` (WebSocket upgrade handler), and `apps/clipsync-server/src/crypto/signatures.ts` (the exact signing scheme this plan's client must match). `DESIGN.md` for the token values Task 1 copies into CSS custom properties.

**Out of scope (separate plan, written once this one is reviewed):** every screen, all JSX/rendering, the QR pairing UI, the Clipboard API capture/manual-paste UI, and the PWA manifest/service worker. This plan produces the modules those screens will import; it renders nothing itself.

## Global Constraints

- The client never sends a plaintext password or account credential — every authenticated request is a signature from a device's own Ed25519 private key. There is no login flow to build.
- The canonical string a signature covers is exactly `${method.toUpperCase()}\n${path}\n${timestampMs}\n${sha256HexOfBody}` — byte-identical to `apps/clipsync-server/src/crypto/signatures.ts`'s `buildCanonicalString`. A mismatch here means every request 401s against the real server.
- Every authenticated HTTP request carries exactly three headers: `X-ClipSync-Device-Id`, `X-ClipSync-Timestamp` (ms epoch as a string), `X-ClipSync-Signature` (base64 of the raw Ed25519 signature bytes).
- The WebSocket handshake carries the same three values as query parameters (`deviceId`, `timestamp`, `signature`) on `GET /clipboard`, since browsers cannot set custom headers on a WebSocket upgrade request. The signed canonical string for the handshake is over the fixed pair `('GET', '/clipboard')` with an empty-body hash, matching `apps/clipsync-server/src/server.ts`'s upgrade handler exactly.
- A device has two keypairs: an Ed25519 pair for request signing (`publicKeyAuthJwk` server-side) and an X25519 pair for content-encryption key agreement (`publicKeyExchangeJwk` server-side). Both are generated once, persisted locally, and the private halves never leave the device — they are generated `extractable: false` and stored as `CryptoKey` objects, never serialized to a string.
- The server never receives plaintext clipboard content. Every `ciphertext` field this client sends to `POST /api/clipboard` must already be encrypted; every `ciphertext` field it reads back from `GET /api/clipboard` must be decrypted client-side before display.
- Target browsers, all of which must support the WebCrypto operations this plan uses: Chrome and Arc/Chromium (Mac and Android), Safari (Mac only).

---

## File Structure

```
apps/clipsync-web/
  src/
    styles/
      tokens.css                — DESIGN.md's token values as CSS custom properties
    lib/
      signing.ts                — sha256Hex, buildCanonicalString, signRequest
      deviceIdentity.ts         — generate/save/load/clear this device's keypairs
      apiClient.ts              — signed fetch wrapper for every backend route
      wsClient.ts                — authenticated WebSocket client with reconnect
      contentCrypto.ts          — ECDH + AES-GCM content encryption/decryption
    main.tsx                    — modified: imports tokens.css (one line)
  tests/
    (co-located *.test.ts files next to each lib module, per Vitest convention
    already established by App.test.tsx sitting next to App.tsx)
```

---

### Task 1: WebCrypto capability check and design tokens

**Files:**
- Create: `apps/clipsync-web/src/lib/signing.ts`
- Test: `apps/clipsync-web/src/lib/signing.test.ts`
- Create: `apps/clipsync-web/src/styles/tokens.css`
- Modify: `apps/clipsync-web/src/main.tsx`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `sha256Hex(data: ArrayBuffer | string): Promise<string>`, `buildCanonicalString(method: string, path: string, timestampMs: string, bodyHashHex: string): string` — both are pure/async utilities every later task in this plan imports.

This task also settles, empirically, whether this Node/Vitest environment's `crypto.subtle` supports Ed25519 and X25519 — the two algorithms every other task depends on. jsdom (this project's default test environment, set in `vite.config.ts`) does not reliably implement WebCrypto's `subtle` operations; Node's own `globalThis.crypto.subtle` (real OpenSSL bindings) does support both algorithms as of the Node version this monorepo already requires (`>=20`, per `apps/clipsync-server`'s own `engines` field). This task's test file therefore overrides the environment to `node` for itself via a Vitest directive, rather than trusting the project-wide jsdom default — a real browser has native `crypto.subtle`, Node's is the closest thing this test runner can exercise directly.

- [ ] **Step 1: Write the failing test**

```ts
// apps/clipsync-web/src/lib/signing.test.ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildCanonicalString, sha256Hex } from './signing.js';

describe('sha256Hex', () => {
  it('hashes an empty string to the known SHA-256 constant', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85',
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/clipsync-web && npx vitest run src/lib/signing.test.ts`
Expected: FAIL — `src/lib/signing.ts` does not exist yet (`Cannot find module './signing.js'`).

- [ ] **Step 3: Implement**

```ts
// apps/clipsync-web/src/lib/signing.ts
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
```

`apps/clipsync-web/src/styles/tokens.css` — copied from DESIGN.md's own "Quick Start → CSS Custom Properties" block (the design system this project already committed to; values are not invented here, they are transcribed):

```css
:root {
  /* Colors */
  --color-carbon: #181925;
  --color-paper-white: #ffffff;
  --color-linen: #fafafa;
  --color-mist: #f5f5f5;
  --color-fog: #e8e8e8;
  --color-ash: #707070; /* darkened from DESIGN.md's #999999 — see PRODUCT.md
                            accessibility note: #999999 fails 4.5:1 AA text
                            contrast on white/linen/mist; #707070 clears it
                            (~4.5-4.95:1) while staying lighter than Carbon. */
  --color-graphite: #666666;
  --color-lavender: #918df6;
  --color-iris: #9580ff;
  --color-mint: #33c758;
  --color-mint-wash: #def6e4;
  --color-amber: #ffa600;
  --color-sky: #2c78fc;
  --color-magenta: #d6409f;
  --color-ember: #ff3e00;

  /* Typography — Font Families */
  --font-openrunde: 'OpenRunde', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

  /* Typography — Scale */
  --text-caption: 12px;
  --leading-caption: 1.33;
  --tracking-caption: -0.32px;
  --text-body: 16px;
  --leading-body: 1.5;
  --tracking-body: -0.32px;
  --text-subheading: 18px;
  --leading-subheading: 1.33;
  --tracking-subheading: -0.32px;
  --text-heading-sm: 24px;
  --leading-heading-sm: 1.17;
  --tracking-heading-sm: -0.31px;
  --text-heading: 36px;
  --leading-heading: 1.22;
  --tracking-heading: -0.61px;
  --text-heading-lg: 48px;
  --leading-heading-lg: 1;
  --tracking-heading-lg: -0.34px;
  --text-display: 60px;
  --leading-display: 1.13;
  --tracking-display: -3px;

  /* Typography — Weights */
  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  /* Spacing */
  --spacing-4: 4px;
  --spacing-8: 8px;
  --spacing-12: 12px;
  --spacing-16: 16px;
  --spacing-20: 20px;
  --spacing-24: 24px;
  --spacing-32: 32px;
  --spacing-48: 48px;
  --spacing-64: 64px;

  /* Layout */
  --page-max-width: 1200px;
  --section-gap: 64px;
  --card-padding: 32px;
  --element-gap: 16px;

  /* Named Radii */
  --radius-tags: 9999px;
  --radius-cards: 16px;
  --radius-images: 8px;
  --radius-inputs: 8px;
  --radius-tables: 24px;
  --radius-buttons: 9999px;

  /* Shadows */
  --shadow-subtle: rgba(0, 0, 0, 0.08) 0px 1px 1px 1px, rgba(0, 0, 0, 0.06) 0px 0px 0px 0.5px;
  --shadow-subtle-2: rgba(0, 0, 0, 0.08) 0px 1px 1px 0px, rgba(0, 0, 0, 0.05) 0px 0px 0px 1px;
  --shadow-subtle-3: rgba(0, 0, 0, 0.06) 0px 1px 3px 0px, rgba(0, 0, 0, 0.06) 0px 8px 16px 0px, rgba(0, 0, 0, 0.02) 0px 0px 0px 1px;

  /* Surfaces */
  --surface-canvas: #ffffff;
  --surface-linen-band: #fafafa;
  --surface-mist-fill: #f5f5f5;
  --surface-mint-wash: #def6e4;

  color-scheme: light;
}
```

`apps/clipsync-web/src/main.tsx` — modify: add the tokens import as the first line:

```tsx
import './styles/tokens.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { router } from './router.js';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/clipsync-web && npx vitest run src/lib/signing.test.ts`
Expected: PASS (7 tests). If the two WebCrypto capability tests (Ed25519, X25519) FAIL in this environment, STOP and report BLOCKED — every later task in this plan depends on both algorithms being available, and the fix is a scope decision (add a JS polyfill such as `@noble/curves`/`@noble/ed25519` and redesign `signing.ts`/`contentCrypto.ts` around it), not something to guess your way past.

Also run the full existing suite once to confirm nothing regressed: `npx vitest run`. Expected: PASS (2 test files: this one plus the existing `App.test.tsx`).

- [ ] **Step 5: Commit**

```bash
cd apps/clipsync-web
git add src/lib/signing.ts src/lib/signing.test.ts src/styles/tokens.css src/main.tsx
git commit -m "feat: signing primitives, WebCrypto capability check, design tokens"
```

---

### Task 2: Device identity generation and persistence

**Files:**
- Create: `apps/clipsync-web/src/lib/deviceIdentity.ts`
- Test: `apps/clipsync-web/src/lib/deviceIdentity.test.ts`
- Modify: `apps/clipsync-web/package.json` — add `idb-keyval` dependency

**Interfaces:**
- Consumes: nothing new from Task 1 directly (this task's own crypto calls are independent), but its tests run under the same `@vitest-environment node` directive for the same reason.
- Produces:
  - `interface DeviceIdentity { deviceId: string; authKeyPair: CryptoKeyPair; exchangeKeyPair: CryptoKeyPair }`
  - `generateDeviceKeys(): Promise<{ authKeyPair: CryptoKeyPair; exchangeKeyPair: CryptoKeyPair }>`
  - `exportPublicJwk(key: CryptoKey): Promise<string>` — returns a JSON string, the exact shape `POST /api/pairing/complete` expects for `publicKeyAuthJwk`/`publicKeyExchangeJwk`.
  - `saveDeviceIdentity(identity: DeviceIdentity): Promise<void>`
  - `loadDeviceIdentity(): Promise<DeviceIdentity | null>`
  - `clearDeviceIdentity(): Promise<void>`
  These four functions are what Task 4 (API client) and the future screens plan use for "does this browser already have a paired identity" and "what do I sign requests with."

- [ ] **Step 1: Write the failing test**

```ts
// apps/clipsync-web/src/lib/deviceIdentity.test.ts
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
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
});
```

Note: `fake-indexeddb` provides a real, spec-compliant IndexedDB implementation for the Node test environment (Node itself has no built-in IndexedDB, unlike `crypto.subtle`). This is only a test dependency — real browsers already have IndexedDB natively, `idb-keyval` talks to it directly there.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/clipsync-web
npm install -D fake-indexeddb
npm install idb-keyval
```

Run: `npx vitest run src/lib/deviceIdentity.test.ts`
Expected: FAIL — `src/lib/deviceIdentity.ts` does not exist yet.

- [ ] **Step 3: Implement**

```ts
// apps/clipsync-web/src/lib/deviceIdentity.ts
import { get, set, del } from 'idb-keyval';

export interface DeviceIdentity {
  deviceId: string;
  authKeyPair: CryptoKeyPair;
  exchangeKeyPair: CryptoKeyPair;
}

const STORAGE_KEY = 'clipsync-device-identity';

export async function generateDeviceKeys(): Promise<{
  authKeyPair: CryptoKeyPair;
  exchangeKeyPair: CryptoKeyPair;
}> {
  const authKeyPair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const exchangeKeyPair = (await crypto.subtle.generateKey({ name: 'X25519' }, false, [
    'deriveBits',
  ])) as CryptoKeyPair;
  return { authKeyPair, exchangeKeyPair };
}

export async function exportPublicJwk(key: CryptoKey): Promise<string> {
  const jwk = await crypto.subtle.exportKey('jwk', key);
  return JSON.stringify(jwk);
}

export async function saveDeviceIdentity(identity: DeviceIdentity): Promise<void> {
  // Public keys must be marked extractable to store/re-export them freely;
  // private keys stay non-extractable throughout — IndexedDB's structured
  // clone algorithm can store a non-extractable CryptoKey directly, it just
  // can never be exported to raw bytes by any code, including this app's.
  await set(STORAGE_KEY, {
    deviceId: identity.deviceId,
    authPrivateKey: identity.authKeyPair.privateKey,
    authPublicKey: identity.authKeyPair.publicKey,
    exchangePrivateKey: identity.exchangeKeyPair.privateKey,
    exchangePublicKey: identity.exchangeKeyPair.publicKey,
  });
}

export async function loadDeviceIdentity(): Promise<DeviceIdentity | null> {
  const stored = await get<{
    deviceId: string;
    authPrivateKey: CryptoKey;
    authPublicKey: CryptoKey;
    exchangePrivateKey: CryptoKey;
    exchangePublicKey: CryptoKey;
  }>(STORAGE_KEY);
  if (!stored) return null;
  return {
    deviceId: stored.deviceId,
    authKeyPair: { privateKey: stored.authPrivateKey, publicKey: stored.authPublicKey },
    exchangeKeyPair: { privateKey: stored.exchangePrivateKey, publicKey: stored.exchangePublicKey },
  };
}

export async function clearDeviceIdentity(): Promise<void> {
  await del(STORAGE_KEY);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/deviceIdentity.test.ts`
Expected: PASS (5 tests). Then `npx vitest run` for the full suite.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/deviceIdentity.ts src/lib/deviceIdentity.test.ts
git commit -m "feat: device identity generation and IndexedDB persistence"
```

---

### Task 3: Request signing

**Files:**
- Modify: `apps/clipsync-web/src/lib/signing.ts` — add `signRequest`
- Modify: `apps/clipsync-web/src/lib/signing.test.ts` — add its tests

**Interfaces:**
- Consumes: `sha256Hex`, `buildCanonicalString` (Task 1, same file); `generateDeviceKeys` (Task 2, test-only).
- Produces: `signRequest(authPrivateKey: CryptoKey, method: string, path: string, bodyBuffer?: ArrayBuffer, timestampMs?: string): Promise<{ timestamp: string; signature: string }>` — Task 4 (API client) and Task 5 (WebSocket client) both call this for every authenticated request/handshake.

- [ ] **Step 1: Write the failing test**

Append to `apps/clipsync-web/src/lib/signing.test.ts`:

```ts
import { generateDeviceKeys } from './deviceIdentity.js';
import { signRequest } from './signing.js';

describe('signRequest', () => {
  it('produces a signature that verifies against the canonical string it covers', async () => {
    const { authKeyPair } = await generateDeviceKeys();
    const bodyBuffer = new TextEncoder().encode(JSON.stringify({ foo: 'bar' })).buffer as ArrayBuffer;
    const { timestamp, signature } = await signRequest(authKeyPair.privateKey, 'POST', '/api/clipboard', bodyBuffer);

    const bodyHash = await sha256Hex(bodyBuffer);
    const canonical = buildCanonicalString('POST', '/api/clipboard', timestamp, bodyHash);
    const signatureBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      { name: 'Ed25519' },
      authKeyPair.publicKey,
      signatureBytes,
      new TextEncoder().encode(canonical),
    );
    expect(valid).toBe(true);
  });

  it('defaults to an empty body when none is given, matching a GET request', async () => {
    const { authKeyPair } = await generateDeviceKeys();
    const { timestamp, signature } = await signRequest(authKeyPair.privateKey, 'GET', '/api/clipboard');

    const emptyBodyHash = await sha256Hex(new ArrayBuffer(0));
    const canonical = buildCanonicalString('GET', '/api/clipboard', timestamp, emptyBodyHash);
    const signatureBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      { name: 'Ed25519' },
      authKeyPair.publicKey,
      signatureBytes,
      new TextEncoder().encode(canonical),
    );
    expect(valid).toBe(true);
  });

  it('uses the timestamp it is given rather than always the current time', async () => {
    const { authKeyPair } = await generateDeviceKeys();
    const { timestamp } = await signRequest(authKeyPair.privateKey, 'GET', '/x', undefined, '1700000000000');
    expect(timestamp).toBe('1700000000000');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/signing.test.ts`
Expected: FAIL — `signRequest` is not exported from `./signing.js`.

- [ ] **Step 3: Implement**

Append to `apps/clipsync-web/src/lib/signing.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/signing.test.ts`
Expected: PASS (10 tests total in this file). Then the full suite: `npx vitest run`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/signing.ts src/lib/signing.test.ts
git commit -m "feat: request signing matching the server's canonical-string scheme"
```

---

### Task 4: Signed API client

**Files:**
- Create: `apps/clipsync-web/src/lib/apiClient.ts`
- Test: `apps/clipsync-web/src/lib/apiClient.test.ts`

**Interfaces:**
- Consumes: `signRequest` (Task 3), `generateDeviceKeys`/`exportPublicJwk` (Task 2, test-only).
- Produces: `createApiClient(config: { baseUrl: string; deviceId: string; authPrivateKey: CryptoKey }): ApiClient`, where:
  ```ts
  interface ApiClient {
    pairingStart(initiatorDeviceName: string, authed: boolean): Promise<{ token: string; expiresAt: string }>;
    pairingComplete(input: { token: string; deviceName: string; publicKeyAuthJwk: string; publicKeyExchangeJwk: string }): Promise<{ deviceId: string; peerDevices: PeerDevice[] }>;
    listClipboard(): Promise<{ items: ClipboardItemDto[] }>;
    addClipboardItem(input: { contentType: string; ciphertext: string }): Promise<ClipboardItemDto>;
    deleteClipboardItem(id: string): Promise<void>;
    clearClipboard(): Promise<void>;
    unpairDevice(deviceId: string): Promise<void>;
    uploadBlob(itemId: string, file: Blob): Promise<ClipboardItemDto>;
    downloadBlob(itemId: string): Promise<Blob>;
  }
  ```
  These are the methods the screens plan's every network-touching component will call — the exact names and shapes above are load-bearing for that future plan, not just this one.

This task hard-codes the route paths/methods from the already-shipped server (`apps/clipsync-server/src/routes/*.ts`) — read those files if anything below looks surprising, they are the actual authority, not this plan's prose.

- [ ] **Step 1: Write the failing test**

```ts
// apps/clipsync-web/src/lib/apiClient.test.ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateDeviceKeys } from './deviceIdentity.js';
import { createApiClient } from './apiClient.js';

describe('createApiClient', () => {
  let authPrivateKey: CryptoKey;
  const deviceId = 'device-under-test';
  const baseUrl = 'https://clipsync.local:3000';

  beforeEach(async () => {
    const keys = await generateDeviceKeys();
    authPrivateKey = keys.authKeyPair.privateKey;
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetchOnce(status: number, body: unknown) {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    });
  }

  it('signs GET /api/clipboard with the three required headers and no body', async () => {
    mockFetchOnce(200, { items: [] });
    const client = createApiClient({ baseUrl, deviceId, authPrivateKey });
    const result = await client.listClipboard();

    expect(result).toEqual({ items: [] });
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${baseUrl}/api/clipboard`);
    expect(init.method).toBe('GET');
    expect(init.headers['X-ClipSync-Device-Id']).toBe(deviceId);
    expect(typeof init.headers['X-ClipSync-Timestamp']).toBe('string');
    expect(typeof init.headers['X-ClipSync-Signature']).toBe('string');
  });

  it('signs POST /api/clipboard over the actual JSON body bytes', async () => {
    mockFetchOnce(201, { id: 'item-1', contentType: 'text/plain', ciphertext: 'abc' });
    const client = createApiClient({ baseUrl, deviceId, authPrivateKey });
    await client.addClipboardItem({ contentType: 'text/plain', ciphertext: 'abc' });

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${baseUrl}/api/clipboard`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ contentType: 'text/plain', ciphertext: 'abc' });
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('calls DELETE /api/clipboard/:id with the id in the path', async () => {
    mockFetchOnce(204, undefined);
    const client = createApiClient({ baseUrl, deviceId, authPrivateKey });
    await client.deleteClipboardItem('item-42');
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${baseUrl}/api/clipboard/item-42`);
    expect(init.method).toBe('DELETE');
  });

  it('calls DELETE /api/clipboard with no id for clearClipboard', async () => {
    mockFetchOnce(204, undefined);
    const client = createApiClient({ baseUrl, deviceId, authPrivateKey });
    await client.clearClipboard();
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${baseUrl}/api/clipboard`);
    expect(init.method).toBe('DELETE');
  });

  it('calls DELETE /api/pairing/devices/:deviceId for unpairDevice', async () => {
    mockFetchOnce(204, undefined);
    const client = createApiClient({ baseUrl, deviceId, authPrivateKey });
    await client.unpairDevice('other-device-id');
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${baseUrl}/api/pairing/devices/other-device-id`);
    expect(init.method).toBe('DELETE');
  });

  it('pairingStart sends no auth headers when authed=false (bootstrap)', async () => {
    mockFetchOnce(200, { token: 'tok', expiresAt: '2026-01-01T00:00:00.000Z' });
    const client = createApiClient({ baseUrl, deviceId, authPrivateKey });
    await client.pairingStart('Yoga’s Mac', false);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${baseUrl}/api/pairing/start`);
    expect(init.headers['X-ClipSync-Device-Id']).toBeUndefined();
  });

  it('pairingStart signs the request when authed=true', async () => {
    mockFetchOnce(200, { token: 'tok', expiresAt: '2026-01-01T00:00:00.000Z' });
    const client = createApiClient({ baseUrl, deviceId, authPrivateKey });
    await client.pairingStart('Yoga’s Mac', true);
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers['X-ClipSync-Device-Id']).toBe(deviceId);
  });

  it('pairingComplete posts to /api/pairing/complete unauthenticated with the given fields', async () => {
    mockFetchOnce(200, { deviceId: 'new-device', peerDevices: [] });
    const client = createApiClient({ baseUrl, deviceId, authPrivateKey });
    const result = await client.pairingComplete({
      token: 'tok',
      deviceName: 'Pixel',
      publicKeyAuthJwk: '{}',
      publicKeyExchangeJwk: '{}',
    });
    expect(result).toEqual({ deviceId: 'new-device', peerDevices: [] });
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${baseUrl}/api/pairing/complete`);
    expect(init.headers['X-ClipSync-Device-Id']).toBeUndefined();
  });

  it('throws with the server-provided error code when a request fails', async () => {
    mockFetchOnce(409, { error: 'max_paired_devices' });
    const client = createApiClient({ baseUrl, deviceId, authPrivateKey });
    await expect(client.pairingStart('x', false)).rejects.toThrow('max_paired_devices');
  });

  it('uploadBlob posts multipart form data to /api/clipboard/:id/blob', async () => {
    mockFetchOnce(200, { id: 'item-1', contentType: 'image/png', blobPath: 'item-1.bin' });
    const client = createApiClient({ baseUrl, deviceId, authPrivateKey });
    const fakeBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    await client.uploadBlob('item-1', fakeBlob);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${baseUrl}/api/clipboard/item-1/blob`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers['X-ClipSync-Device-Id']).toBe(deviceId);
  });

  it('downloadBlob GETs /api/clipboard/:id/blob and returns a Blob', async () => {
    const fakeBlob = new Blob(['fake-bytes']);
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      ok: true,
      blob: async () => fakeBlob,
    });
    const client = createApiClient({ baseUrl, deviceId, authPrivateKey });
    const result = await client.downloadBlob('item-1');
    expect(result).toBe(fakeBlob);
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${baseUrl}/api/clipboard/item-1/blob`);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/apiClient.test.ts`
Expected: FAIL — `src/lib/apiClient.ts` does not exist yet.

- [ ] **Step 3: Implement**

```ts
// apps/clipsync-web/src/lib/apiClient.ts
import { signRequest } from './signing.js';

export interface PeerDevice {
  deviceId: string;
  deviceName: string;
  publicKeyAuthJwk: string;
  publicKeyExchangeJwk: string;
  pairedAt: string;
  revokedAt: string | null;
}

export interface ClipboardItemDto {
  id: string;
  contentType: string;
  ciphertext: string | null;
  blobPath: string | null;
  deviceId: string;
  deviceName: string;
  createdAt: string;
}

export interface ApiClientConfig {
  baseUrl: string;
  deviceId: string;
  authPrivateKey: CryptoKey;
}

class ApiError extends Error {
  constructor(
    public status: number,
    errorCode: string,
  ) {
    super(errorCode);
    this.name = 'ApiError';
  }
}

export interface ApiClient {
  pairingStart(initiatorDeviceName: string, authed: boolean): Promise<{ token: string; expiresAt: string }>;
  pairingComplete(input: {
    token: string;
    deviceName: string;
    publicKeyAuthJwk: string;
    publicKeyExchangeJwk: string;
  }): Promise<{ deviceId: string; peerDevices: PeerDevice[] }>;
  listClipboard(): Promise<{ items: ClipboardItemDto[] }>;
  addClipboardItem(input: { contentType: string; ciphertext: string }): Promise<ClipboardItemDto>;
  deleteClipboardItem(id: string): Promise<void>;
  clearClipboard(): Promise<void>;
  unpairDevice(deviceId: string): Promise<void>;
  uploadBlob(itemId: string, file: Blob): Promise<ClipboardItemDto>;
  downloadBlob(itemId: string): Promise<Blob>;
}

export function createApiClient({ baseUrl, deviceId, authPrivateKey }: ApiClientConfig): ApiClient {
  async function authedHeaders(method: string, path: string, bodyBuffer?: ArrayBuffer) {
    const { timestamp, signature } = await signRequest(authPrivateKey, method, path, bodyBuffer);
    return {
      'X-ClipSync-Device-Id': deviceId,
      'X-ClipSync-Timestamp': timestamp,
      'X-ClipSync-Signature': signature,
    };
  }

  async function parseJsonOrThrow(res: Response) {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(res.status, (body as { error?: string }).error ?? `http_${res.status}`);
    }
    return body;
  }

  return {
    async pairingStart(initiatorDeviceName, authed) {
      const path = '/api/pairing/start';
      const bodyBuffer = new TextEncoder().encode(JSON.stringify({ initiatorDeviceName })).buffer as ArrayBuffer;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authed) Object.assign(headers, await authedHeaders('POST', path, bodyBuffer));
      const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify({ initiatorDeviceName }) });
      return parseJsonOrThrow(res);
    },

    async pairingComplete(input) {
      const path = '/api/pairing/complete';
      const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      return parseJsonOrThrow(res);
    },

    async listClipboard() {
      const path = '/api/clipboard';
      const headers = await authedHeaders('GET', path);
      const res = await fetch(`${baseUrl}${path}`, { method: 'GET', headers });
      return parseJsonOrThrow(res);
    },

    async addClipboardItem(input) {
      const path = '/api/clipboard';
      const bodyBuffer = new TextEncoder().encode(JSON.stringify(input)).buffer as ArrayBuffer;
      const headers = { 'Content-Type': 'application/json', ...(await authedHeaders('POST', path, bodyBuffer)) };
      const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(input) });
      return parseJsonOrThrow(res);
    },

    async deleteClipboardItem(id) {
      const path = `/api/clipboard/${id}`;
      const headers = await authedHeaders('DELETE', path);
      const res = await fetch(`${baseUrl}${path}`, { method: 'DELETE', headers });
      if (!res.ok) throw new ApiError(res.status, `http_${res.status}`);
    },

    async clearClipboard() {
      const path = '/api/clipboard';
      const headers = await authedHeaders('DELETE', path);
      const res = await fetch(`${baseUrl}${path}`, { method: 'DELETE', headers });
      if (!res.ok) throw new ApiError(res.status, `http_${res.status}`);
    },

    async unpairDevice(targetDeviceId) {
      const path = `/api/pairing/devices/${targetDeviceId}`;
      const headers = await authedHeaders('DELETE', path);
      const res = await fetch(`${baseUrl}${path}`, { method: 'DELETE', headers });
      if (!res.ok) throw new ApiError(res.status, `http_${res.status}`);
    },

    async uploadBlob(itemId, file) {
      const path = `/api/clipboard/${itemId}/blob`;
      const fileBuffer = await file.arrayBuffer();
      const headers = await authedHeaders('POST', path, fileBuffer);
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: formData });
      return parseJsonOrThrow(res);
    },

    async downloadBlob(itemId) {
      const path = `/api/clipboard/${itemId}/blob`;
      const headers = await authedHeaders('GET', path);
      const res = await fetch(`${baseUrl}${path}`, { method: 'GET', headers });
      if (!res.ok) throw new ApiError(res.status, `http_${res.status}`);
      return res.blob();
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/apiClient.test.ts`
Expected: PASS (12 tests). Then the full suite: `npx vitest run`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/apiClient.ts src/lib/apiClient.test.ts
git commit -m "feat: signed API client matching the shipped server contract"
```

---

### Task 5: Authenticated WebSocket client

**Files:**
- Create: `apps/clipsync-web/src/lib/wsClient.ts`
- Test: `apps/clipsync-web/src/lib/wsClient.test.ts`
- Modify: `apps/clipsync-web/package.json` — add `ws` as a devDependency (a real WebSocket server to test against; the browser's native `WebSocket` is the client under test, `ws` plays the role `apps/clipsync-server` plays in production)

**Interfaces:**
- Consumes: `signRequest` (Task 3).
- Produces:
  ```ts
  type ClipboardEvent =
    | { type: 'clipboard.created'; item: ClipboardItemDto }
    | { type: 'clipboard.deleted'; id: string }
    | { type: 'clipboard.cleared' };

  interface WsClient {
    close(): void;
  }

  function createWsClient(config: {
    baseUrl: string; // e.g. 'https://host:3000' or 'http://host:3000'
    deviceId: string;
    authPrivateKey: CryptoKey;
    onEvent: (event: ClipboardEvent) => void;
    onStatusChange: (status: 'connecting' | 'open' | 'closed') => void;
  }): WsClient;
  ```
  The screens plan's connection-status pill and real-time list updates both come from `onStatusChange`/`onEvent` here.

`createWsClient` derives the WebSocket URL from `baseUrl` by swapping the scheme (`http`→`ws`, `https`→`wss`) and appending `/clipboard` with the three auth values as query parameters — exactly the scheme `apps/clipsync-server/src/server.ts`'s `server.on('upgrade', ...)` handler expects (canonical string signed over the fixed pair `('GET', '/clipboard')` with an empty body hash).

- [ ] **Step 1: Write the failing test**

```ts
// apps/clipsync-web/src/lib/wsClient.test.ts
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { generateDeviceKeys } from './deviceIdentity.js';
import { signRequest } from './signing.js';
import { createWsClient } from './wsClient.js';

describe('createWsClient', () => {
  let wss: WebSocketServer;
  let client: ReturnType<typeof createWsClient> | undefined;

  afterEach(() => {
    client?.close();
    wss?.close();
  });

  it('connects with deviceId/timestamp/signature as query parameters', async () => {
    const { authKeyPair } = await generateDeviceKeys();
    const deviceId = 'device-1';

    wss = new WebSocketServer({ port: 0 });
    const port = (wss.address() as { port: number }).port;

    const receivedUrl = await new Promise<URL>((resolve) => {
      wss.on('connection', (_ws, req) => {
        resolve(new URL(req.url ?? '', 'http://localhost'));
      });
    }).then((urlPromise) => {
      client = createWsClient({
        baseUrl: `http://127.0.0.1:${port}`,
        deviceId,
        authPrivateKey: authKeyPair.privateKey,
        onEvent: () => {},
        onStatusChange: () => {},
      });
      return urlPromise;
    });

    expect(receivedUrl.pathname).toBe('/clipboard');
    expect(receivedUrl.searchParams.get('deviceId')).toBe(deviceId);
    expect(typeof receivedUrl.searchParams.get('timestamp')).toBe('string');
    expect(typeof receivedUrl.searchParams.get('signature')).toBe('string');
  });

  it('reports status transitions: connecting then open', async () => {
    const { authKeyPair } = await generateDeviceKeys();
    wss = new WebSocketServer({ port: 0 });
    const port = (wss.address() as { port: number }).port;

    const statuses: string[] = [];
    const openPromise = new Promise<void>((resolve) => {
      client = createWsClient({
        baseUrl: `http://127.0.0.1:${port}`,
        deviceId: 'device-1',
        authPrivateKey: authKeyPair.privateKey,
        onEvent: () => {},
        onStatusChange: (status) => {
          statuses.push(status);
          if (status === 'open') resolve();
        },
      });
    });
    await openPromise;
    expect(statuses).toEqual(['connecting', 'open']);
  });

  it('parses and forwards a clipboard.created event received from the server', async () => {
    const { authKeyPair } = await generateDeviceKeys();
    wss = new WebSocketServer({ port: 0 });
    const port = (wss.address() as { port: number }).port;

    wss.on('connection', (ws) => {
      ws.send(
        JSON.stringify({
          type: 'clipboard.created',
          item: { id: 'item-1', contentType: 'text/plain', ciphertext: 'x', blobPath: null, deviceId: 'd', deviceName: 'Mac', createdAt: '2026-01-01T00:00:00.000Z' },
        }),
      );
    });

    const eventPromise = new Promise((resolve) => {
      client = createWsClient({
        baseUrl: `http://127.0.0.1:${port}`,
        deviceId: 'device-1',
        authPrivateKey: authKeyPair.privateKey,
        onEvent: resolve,
        onStatusChange: () => {},
      });
    });

    const event = await eventPromise;
    expect(event).toEqual({
      type: 'clipboard.created',
      item: expect.objectContaining({ id: 'item-1', ciphertext: 'x' }),
    });
  });

  it('close() reports a closed status and stops reconnecting', async () => {
    const { authKeyPair } = await generateDeviceKeys();
    wss = new WebSocketServer({ port: 0 });
    const port = (wss.address() as { port: number }).port;

    const statuses: string[] = [];
    await new Promise<void>((resolve) => {
      client = createWsClient({
        baseUrl: `http://127.0.0.1:${port}`,
        deviceId: 'device-1',
        authPrivateKey: authKeyPair.privateKey,
        onEvent: () => {},
        onStatusChange: (status) => {
          statuses.push(status);
          if (status === 'open') resolve();
        },
      });
    });

    client!.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(statuses[statuses.length - 1]).toBe('closed');
  });

  it('canonical string for the handshake matches signRequest over the fixed (GET, /clipboard) pair', async () => {
    const { authKeyPair } = await generateDeviceKeys();
    wss = new WebSocketServer({ port: 0 });
    const port = (wss.address() as { port: number }).port;

    const receivedUrl = await new Promise<URL>((resolve) => {
      wss.on('connection', (_ws, req) => resolve(new URL(req.url ?? '', 'http://localhost')));
      client = createWsClient({
        baseUrl: `http://127.0.0.1:${port}`,
        deviceId: 'device-1',
        authPrivateKey: authKeyPair.privateKey,
        onEvent: () => {},
        onStatusChange: () => {},
      });
    });

    const timestamp = receivedUrl.searchParams.get('timestamp')!;
    const signature = receivedUrl.searchParams.get('signature')!;
    // Reproduce what the client should have signed and confirm it verifies —
    // proves the handshake uses the same scheme signRequest already tests,
    // not a divergent one-off implementation.
    const independentlySigned = await signRequest(authKeyPair.privateKey, 'GET', '/clipboard', undefined, timestamp);
    expect(independentlySigned.signature).toBe(signature);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm install -D ws @types/ws
```

Run: `npx vitest run src/lib/wsClient.test.ts`
Expected: FAIL — `src/lib/wsClient.ts` does not exist yet.

- [ ] **Step 3: Implement**

```ts
// apps/clipsync-web/src/lib/wsClient.ts
import { signRequest } from './signing.js';
import type { ClipboardItemDto } from './apiClient.js';

export type ClipboardEvent =
  | { type: 'clipboard.created'; item: ClipboardItemDto }
  | { type: 'clipboard.deleted'; id: string }
  | { type: 'clipboard.cleared' };

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export interface WsClientConfig {
  baseUrl: string;
  deviceId: string;
  authPrivateKey: CryptoKey;
  onEvent: (event: ClipboardEvent) => void;
  onStatusChange: (status: ConnectionStatus) => void;
}

export interface WsClient {
  close(): void;
}

const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000];

export function createWsClient({
  baseUrl,
  deviceId,
  authPrivateKey,
  onEvent,
  onStatusChange,
}: WsClientConfig): WsClient {
  let socket: WebSocket | undefined;
  let closedByCaller = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  async function connect() {
    onStatusChange('connecting');
    const { timestamp, signature } = await signRequest(authPrivateKey, 'GET', '/clipboard');
    const wsBase = baseUrl.replace(/^http/, 'ws');
    const url = new URL(`${wsBase}/clipboard`);
    url.searchParams.set('deviceId', deviceId);
    url.searchParams.set('timestamp', timestamp);
    url.searchParams.set('signature', signature);

    socket = new WebSocket(url.toString());

    socket.addEventListener('open', () => {
      reconnectAttempt = 0;
      onStatusChange('open');
    });

    socket.addEventListener('message', (messageEvent) => {
      try {
        const parsed = JSON.parse(messageEvent.data as string) as ClipboardEvent;
        onEvent(parsed);
      } catch {
        // A malformed message from the server is dropped, never thrown —
        // one bad frame must not take down the client's event loop.
      }
    });

    socket.addEventListener('close', () => {
      onStatusChange('closed');
      if (closedByCaller) return;
      const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    });

    socket.addEventListener('error', () => {
      // The subsequent 'close' event drives the reconnect/backoff logic —
      // this listener only exists so an error is never an unhandled
      // exception (browsers can otherwise surface it as one).
    });
  }

  connect();

  return {
    close() {
      closedByCaller = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/wsClient.test.ts`
Expected: PASS (5 tests). Then the full suite: `npx vitest run`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/wsClient.ts src/lib/wsClient.test.ts
git commit -m "feat: authenticated WebSocket client with reconnect and backoff"
```

---

### Task 6: End-to-end content encryption

**Files:**
- Create: `apps/clipsync-web/src/lib/contentCrypto.ts`
- Test: `apps/clipsync-web/src/lib/contentCrypto.test.ts`

**Interfaces:**
- Consumes: `generateDeviceKeys` (Task 2, test-only).
- Produces:
  - `deriveSharedKey(myExchangePrivateKey: CryptoKey, peerExchangePublicKeyJwk: string): Promise<CryptoKey>` — an AES-256-GCM `CryptoKey`, derived via X25519 ECDH between this device and its one paired peer, then HKDF. **Correction, added after the final whole-branch review:** the sentence originally here claimed the screens plan could always get the peer's key from `peerDevices[0].publicKeyExchangeJwk` in the `pairingComplete` response. That is true only for the device that *joins* an existing pairing — the server only returns `peerDevices` in that one response, to that one caller. The device that *pairs first* (typically the Mac, which displays the QR) gets `peerDevices: []` on its own bootstrap completion and currently has no route to ever learn the joining device's key afterward. See "Notes for the screens plan" below — this is now Critical finding C1 from that review, and it must be closed (a new backend route plus a new client method, in both already-shipped plans) before the screens plan can actually implement bidirectional encryption, not just before this one sentence is accurate.
  - `encryptContent(sharedKey: CryptoKey, plaintext: string): Promise<string>` — returns one base64 string encoding `iv || ciphertext`; this is exactly the value that becomes `ciphertext` in `addClipboardItem`.
  - `decryptContent(sharedKey: CryptoKey, encoded: string): Promise<string>` — the inverse, used on every item read back from `listClipboard`/a `clipboard.created` WebSocket event.

This is the layer that makes the product's core claim (PRODUCT.md: "the server never sees plaintext") literally true rather than aspirational — nothing upstream of this task may skip it.

- [ ] **Step 1: Write the failing test**

```ts
// apps/clipsync-web/src/lib/contentCrypto.test.ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/contentCrypto.test.ts`
Expected: FAIL — `src/lib/contentCrypto.ts` does not exist yet.

- [ ] **Step 3: Implement**

```ts
// apps/clipsync-web/src/lib/contentCrypto.ts

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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/contentCrypto.test.ts`
Expected: PASS (4 tests). Then the full suite: `npx vitest run`, and `npx tsc --noEmit -p tsconfig.json`. Both must be clean before this task is done.

- [ ] **Step 5: Commit**

```bash
git add src/lib/contentCrypto.ts src/lib/contentCrypto.test.ts
git commit -m "feat: end-to-end content encryption (X25519 ECDH + HKDF + AES-GCM)"
```

---

## Self-Review

**Spec coverage:**

- Device identity generation, non-extractable private keys, persistence across launches → Task 2.
- Request signing matching the server's exact canonical-string scheme → Tasks 1, 3, verified against real `crypto.subtle.verify` in every signing test, not just re-deriving the same code path.
- Every backend route this plan's consumers will need (pairing start/complete, clipboard CRUD, unpair, blob upload/download) → Task 4, one test per route, hard-coded against the actual shipped route paths in `apps/clipsync-server`.
- WebSocket handshake auth matching the server's query-parameter scheme, reconnect/backoff, event parsing → Task 5.
- "Server never sees plaintext" → Task 6, independently proven by two separately-generated devices deriving the same key and successfully round-tripping content, plus a negative test proving a third party's key cannot decrypt it.
- DESIGN.md token values available to the eventual screens → Task 1's `tokens.css`.
- The one already-known accessibility gap from the Paper.design work (Ash #999999 failing AA contrast) → carried into `tokens.css` as the already-decided fix (#707070), not left for the screens plan to rediscover.

Not covered here, by design (belongs to the screens plan): all JSX/rendering, the QR generation/scanning libraries and UI, the Clipboard API capture and manual-paste-fallback UI, PWA manifest/service worker, and the React Context/hooks that will wrap these modules for component consumption.

**Placeholder scan:** no `TBD`/`TODO`/"handle appropriately" language in any task; every step has runnable code. The one deliberately-flagged contingency is Task 1's capability check — if it fails, the task's own instructions say to stop and report BLOCKED rather than guess, which is a real escalation path, not a placeholder.

**Type consistency:** `ClipboardItemDto`, `PeerDevice`, `ClipboardEvent`, `ConnectionStatus`, `DeviceIdentity` are each defined once (in `apiClient.ts`, `apiClient.ts`, `wsClient.ts`, `wsClient.ts`, `deviceIdentity.ts` respectively) and imported by name everywhere else they're used — `wsClient.ts` imports `ClipboardItemDto` from `apiClient.ts` rather than redefining it. Function names (`generateDeviceKeys`, `exportPublicJwk`, `signRequest`, `deriveSharedKey`, `encryptContent`, `decryptContent`) are used identically across every task that references them.

---

## Next plan (not written yet)

Once this foundation is reviewed and merged, write `clipsync-web-screens` covering: the React Context wiring these six modules into components, and the eleven screens from the Paper.design file (`https://app.paper.design/file/01M2ME4Q0008TQEFQ6H8X4D35E`) — main (populated/copied/empty), manual paste fallback, disconnected, pairing scan/success, settings, item detail, Mac desktop main, Mac pair-phone QR display — plus QR generation (`qrcode`) and scanning (`qr-scanner` or `BarcodeDetector` with a fallback) and the PWA manifest/service worker (`vite-plugin-pwa`, already installed as a dependency but unconfigured). That plan should cite this one's exact exported function signatures as its interface, the way this plan cited the shipped backend's routes.

### Prerequisites — resolve before writing that plan, not while writing it

The final whole-branch review of this plan (see the ledger) found three gaps that are new work, not bugs in what shipped here. All three block real functionality the screens plan would otherwise be asked to build around:

- **C1 (Critical): the pairing initiator can never learn its peer's exchange key.** The server's `POST /api/pairing/complete` returns `peerDevices` only to the device that just joined; the device that paired first (the Mac, which displays the QR) gets `peerDevices: []` and has no route to ever learn the phone's key afterward. E2E encryption cannot work bidirectionally without fixing this. Fix spans both already-shipped plans: add `GET /api/pairing/devices` (authenticated, returns `{ devices: listActiveDevices() }`) to `apps/clipsync-server`, and a matching `listDevices()` method to this plan's `apiClient.ts`. Consider also having `pairingComplete` broadcast a `device.paired` WebSocket event for real-time pickup on the initiator's side, in which case `ClipboardEvent`'s union in `wsClient.ts` grows a new variant.
- **I1 (Important): no byte-level encryption primitive for images.** `contentCrypto.ts` only has `encryptContent`/`decryptContent` over strings. PRD requires images be E2E encrypted too, and `apiClient.uploadBlob` takes a `Blob`. Add `encryptBytes(key, data: BufferSource): Promise<Uint8Array>` / `decryptBytes(key, frame: Uint8Array): Promise<Uint8Array>` to `contentCrypto.ts`, producing the same `iv || ciphertext(+tag)` frame; make the string versions thin wrappers over these.
- **I2 (Important): no CORS / same-origin story.** The server has no CORS middleware; every authenticated request carries custom `X-ClipSync-*` headers, which trigger a preflight `OPTIONS` the server doesn't handle — every REST call would be blocked by the browser from any origin other than the server's own, while the WebSocket (CORS-exempt) would connect fine, producing a confusing "connected but nothing works" state. Recommended fix: serve the built SPA from `clipsync-server` itself (`express.static` + SPA fallback) so app, API, and WebSocket share one origin and the phone trusts one TLS certificate; default the client's `baseUrl` to `window.location.origin`; add a Vite dev-server proxy for local development.

### Other forward notes (not blocking, but the screens plan should know these before it starts)

- **Bootstrap flow specifics:** the first-ever device calls `pairingStart(name, false)` (unauthenticated) and then `pairingComplete` on itself — there is no separate "am I first" check the client needs to make beyond what `loadDeviceIdentity()` already tells it. `authed` passed to `pairingStart` should simply mirror `loadDeviceIdentity() !== null`. Before an identity exists, `createApiClient` needs *some* `deviceId`/`authPrivateKey` values even though they won't be used on the unauthenticated path — consider making those two config fields optional, or generating a throwaway identity slightly earlier in the flow than "fully paired."
- **`peerDevices` is `[]` on bootstrap** — that's the normal first-device case, not an error state, and is a separate thing from "no peer key yet because I'm the initiator" (C1, above).
- **Verify the peer's key, don't just trust it.** The PRD's QR code can carry more than the pairing token — consider putting a SHA-256 fingerprint of the initiator's exchange public key in the QR payload (the PRD only forbids *private* keys there) and having the joining device check `peerDevices[0].publicKeyExchangeJwk` against that fingerprint before ever deriving a shared key with it. Without this, peer-key authenticity rests entirely on the server's honesty at the moment of pairing.
- **Image items need a non-empty `ciphertext` at creation time**, before the blob is uploaded (Task 6/7 of the core-server plan's own ruling) — `ciphertext` becomes `null` once the upload completes. Never pass a `null` `ciphertext` to `decryptContent`.
- **`authWindowMs` is 30 seconds.** On an unexpected 401, compare the server response's `Date` header to `Date.now()` before assuming the device was revoked — a wrong system clock produces the identical error and needs a different message ("check your clock" vs. "re-pair this device").
- **An unreachable server surfaces from `fetch` as a plain `TypeError`, not an `ApiError`** — the screens plan's error handling needs to branch on error TYPE, not just assume every network failure has a `.status`.
- **Effective text ceiling is ~700 KB, not the server's stated 1 MB** — encrypted-then-base64-encoded content runs about 1.37× the plaintext size, so the "content too large" UI state needs a number smaller than the raw server limit.
- **`pairingTtlMs` is 120 seconds** — that's how long the displayed QR code stays valid; the pairing-QR screen needs its own countdown/expiry UI, not just a static image.
- **Design property worth stating explicitly rather than leaving implicit:** this design uses one static X25519 key pair per device for the lifetime of a pairing — there is no forward secrecy and no key rotation. Acceptable for this product's threat model (PRD's threat model — same-Wi-Fi stranger, URL knower, DB reader, old QR, removed phone, log inspector — is satisfied as designed), but a deliberate choice worth recording as one, not rediscovering by accident later.
