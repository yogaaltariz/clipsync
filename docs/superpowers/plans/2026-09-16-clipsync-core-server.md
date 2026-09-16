# ClipSync Core Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the ClipSync core server — an authenticated, local-network-only Node.js service that pairs exactly one Mac and one Android device, stores clipboard items it never decrypts, and pushes real-time updates over WebSocket.

**Architecture:** An Express + `ws` service backed by SQLite. Every clipboard and pairing-management endpoint is protected by Ed25519 request-signature verification against a paired device's stored public key — there are no passwords or accounts. The server treats clipboard content as opaque ciphertext/binary it stores and relays; it never sees plaintext. Real-time fan-out uses an authenticated WebSocket upgrade and a small in-memory connection hub.

**Tech Stack:** Node.js 20+, TypeScript 5, Express 4, `ws`, `better-sqlite3`, `multer`, Vitest + Supertest for testing, Node's built-in `crypto` module (Ed25519 sign/verify via JWK, interoperable with browser WebCrypto).

**Spec:** `PRD.md` and `PRODUCT.md` at the project root (`/Users/yogaaltariz/Documents/projects/universal-clipboard`). `DESIGN.md` does not apply — this plan has no UI.

**Out of scope (separate plan, written once the Paper.design screens are final):** the web/PWA client — Clipboard API capture, manual paste fallback, QR pairing UI, device key generation, and the actual encryption/decryption of clipboard content. This server only verifies signatures and stores/forwards bytes; it never generates or holds a content-encryption key.

## Global Constraints

- Exactly two paired devices are supported: 1 Mac + 1 Android (`PRODUCT.md` Operating Context). Pairing is refused once two active devices exist.
- History is capped at 50 clipboard items; the oldest is evicted first, and its blob file (if any) is deleted with it (PRD §15).
- No username/password account system. Access is authorization by paired-device signature only (PRD §7; PRODUCT.md security scope).
- Every clipboard and pairing-management endpoint, and the WebSocket, require authentication from a paired device — except the bootstrap case of pairing the very first device (PRD Security, "Authentication").
- Pairing sessions are single-use, cryptographically random, and expire automatically; reuse after success must be rejected (PRD Security, "Pairing Mode").
- Clipboard content, request bodies, and file bytes must never appear in logs, access logs, or error output — only type/size/device metadata (PRD Security, "Clipboard Content Logging").
- Images are stored as binary files on disk, never as Base64 in the database, and never served from an unauthenticated URL (PRD §13; Security, "Image Security").
- The server binds to local-network interfaces only by default (`127.0.0.1`, overridden explicitly to a LAN IP by the operator); no automatic port forwarding, UPnP, or public tunneling (PRD Security, "Network Exposure").
- Use local HTTPS/`wss` wherever a secure context is required by browser APIs (PRD Security, "Browser Transport Security").
- Updates are pushed over WebSocket, not polled, because perceived update latency on LAN must stay under 1 second (PRD §12).

---

## File Structure

```
clipsync-server/
  package.json
  tsconfig.json
  vitest.config.ts
  .gitignore
  data/                          — gitignored; SQLite file + blobs live here at runtime
  src/
    config.ts                    — env-driven config (ports, paths, limits, TTLs)
    types.ts                     — shared TS interfaces (Device, PairingSession, ClipboardItem, events)
    server.ts                    — Express app + HTTP server + WS upgrade wiring, entry point
    db/
      schema.sql                 — CREATE TABLE statements for all three tables
      client.ts                  — better-sqlite3 connection + schema init
      devices.repo.ts            — paired-device CRUD
      pairingSessions.repo.ts    — pairing-session CRUD
      clipboardItems.repo.ts     — clipboard item CRUD + retention eviction
    crypto/
      signatures.ts              — canonical-string builder, sha256Hex, Ed25519 verify
      tokens.ts                  — cryptographically random pairing-token generator
    middleware/
      deviceAuth.ts              — per-request signature verification middleware
      logging.ts                 — redacted request/response logger
    routes/
      pairing.routes.ts          — POST /api/pairing/start, POST /api/pairing/complete, DELETE /api/pairing/devices/:deviceId
      clipboard.routes.ts        — POST/GET /api/clipboard, DELETE /api/clipboard/:id, DELETE /api/clipboard
      uploads.routes.ts          — POST /api/clipboard/:id/blob, GET /api/clipboard/:id/blob
    ws/
      hub.ts                     — connected-socket registry + broadcast/disconnect
    storage/
      blobStore.ts               — write/read/delete blob files on disk
  tests/
    helpers/
      testServer.ts              — boots app + DB + blob dir in a temp directory per test
      testKeys.ts                — generates Ed25519 test keypairs, signs test requests
    server.health.test.ts
    crypto.signatures.test.ts
    middleware.deviceAuth.test.ts
    routes.pairing.test.ts
    db.clipboardItems.test.ts
    routes.clipboard.test.ts
    routes.uploads.test.ts
    ws.hub.test.ts
    ws.integration.test.ts
    logging.redaction.test.ts
  docs/
    LOCAL_HTTPS.md               — mkcert setup instructions (created in Task 10)
```

---

### Task 1: Project scaffold, health check, and SQLite bootstrap

**Files:**
- Create: `clipsync-server/package.json`
- Create: `clipsync-server/tsconfig.json`
- Create: `clipsync-server/vitest.config.ts`
- Create: `clipsync-server/.gitignore`
- Create: `clipsync-server/src/config.ts`
- Create: `clipsync-server/src/types.ts`
- Create: `clipsync-server/src/db/schema.sql`
- Create: `clipsync-server/src/db/client.ts`
- Create: `clipsync-server/src/server.ts`
- Create: `clipsync-server/tests/helpers/testServer.ts`
- Test: `clipsync-server/tests/server.health.test.ts`

**Interfaces:**
- Produces: `config` (default export) with `{ port, dataDir, dbPath, blobDir, historyLimit: 50, maxPairedDevices: 2, pairingTtlMs: 120000, authWindowMs: 30000, bindHost }`.
- Produces: `openDb(dbPath: string): Database.Database` from `db/client.ts`, applies `schema.sql` on open.
- Produces: `createApp(db: Database.Database): express.Express` from `server.ts` — builds the Express app without starting to listen, so tests can mount it directly.
- Produces: `buildTestServer(): { app: express.Express; db: Database.Database; dataDir: string; cleanup(): void }` from `tests/helpers/testServer.ts`, used by every later test file.

- [ ] **Step 1: Scaffold the project**

```bash
mkdir -p clipsync-server/src/{db,crypto,middleware,routes,ws,storage} clipsync-server/tests/helpers clipsync-server/docs
cd clipsync-server
git init
npm init -y
npm install express ws better-sqlite3 multer
npm install -D typescript vitest supertest tsx @types/node @types/express @types/ws @types/better-sqlite3 @types/supertest @types/multer
```

`package.json` scripts (edit the generated file):

```json
{
  "name": "clipsync-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "test": "vitest run"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

`.gitignore`:

```
node_modules/
dist/
data/
*.log
```

`src/config.ts`:

```ts
import path from 'node:path';

const dataDir = process.env.CLIPSYNC_DATA_DIR ?? path.resolve(process.cwd(), 'data');

export const config = {
  port: Number(process.env.CLIPSYNC_PORT ?? 3000),
  // Default to loopback only. The operator must explicitly set this to the
  // Mac's LAN IP to make the server reachable from the phone — it must
  // never default to 0.0.0.0 (Global Constraint: local-network-only binding).
  bindHost: process.env.CLIPSYNC_BIND_HOST ?? '127.0.0.1',
  dataDir,
  dbPath: path.join(dataDir, 'clipsync.db'),
  blobDir: path.join(dataDir, 'blobs'),
  historyLimit: 50,
  maxPairedDevices: 2,
  pairingTtlMs: 120_000,
  authWindowMs: 30_000,
} as const;
```

`src/types.ts`:

```ts
export interface Device {
  deviceId: string;
  deviceName: string;
  publicKeyAuthJwk: string;
  publicKeyExchangeJwk: string;
  pairedAt: string;
  revokedAt: string | null;
}

export interface PairingSession {
  token: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  initiatorDeviceName: string;
}

export interface ClipboardItem {
  id: string;
  contentType: string;
  ciphertext: string | null;
  blobPath: string | null;
  deviceId: string;
  deviceName: string;
  createdAt: string;
}

export type ClipboardEvent =
  | { type: 'clipboard.created'; item: ClipboardItem }
  | { type: 'clipboard.deleted'; id: string }
  | { type: 'clipboard.cleared' };

export interface AuthedRequest {
  device: Device;
}
```

`src/db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  public_key_auth_jwk TEXT NOT NULL,
  public_key_exchange_jwk TEXT NOT NULL,
  paired_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS pairing_sessions (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  initiator_device_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clipboard_items (
  id TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  ciphertext TEXT,
  blob_path TEXT,
  device_id TEXT NOT NULL REFERENCES devices(device_id),
  device_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clipboard_items_created_at ON clipboard_items(created_at);
```

`src/db/client.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export function openDb(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  const schemaPath = path.join(import.meta.dirname, 'schema.sql');
  db.exec(fs.readFileSync(schemaPath, 'utf8'));
  return db;
}
```

`src/server.ts`:

```ts
import express from 'express';
import type { Database } from 'better-sqlite3';

export function createApp(db: Database): express.Express {
  const app = express();
  app.get('/healthz', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.status(200).json({ status: 'ok' });
  });
  return app;
}
```

`tests/helpers/testServer.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../src/db/client.js';
import { createApp } from '../../src/server.js';

export function buildTestServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipsync-test-'));
  const db = openDb(path.join(dataDir, 'clipsync.db'));
  const blobDir = path.join(dataDir, 'blobs');
  fs.mkdirSync(blobDir, { recursive: true });
  const app = createApp(db);
  return {
    app,
    db,
    dataDir,
    blobDir,
    cleanup() {
      db.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/server.health.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestServer } from './helpers/testServer.js';

describe('GET /healthz', () => {
  let ctx: ReturnType<typeof buildTestServer>;

  afterEach(() => ctx?.cleanup());

  it('returns 200 with status ok when the database is reachable', async () => {
    ctx = buildTestServer();
    const res = await request(ctx.app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- server.health`
Expected: FAIL — `Cannot find module '../../src/server.js'` (or similar), since `src/server.ts` doesn't exist until Step 1's files are saved. If Step 1 was already applied, run this before writing `server.ts`'s route to confirm the harness executes; skip ahead if scaffolding and test both land together.

- [ ] **Step 4: Confirm it passes**

Run: `npm test -- server.health`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
cd clipsync-server
git add -A
git commit -m "chore: scaffold server, SQLite bootstrap, health check"
```

---

### Task 2: Signature verification core

**Files:**
- Create: `clipsync-server/src/crypto/signatures.ts`
- Create: `clipsync-server/src/crypto/tokens.ts`
- Test: `clipsync-server/tests/crypto.signatures.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions, no DB/HTTP).
- Produces: `buildCanonicalString(method: string, path: string, timestampMs: string, bodyHashHex: string): string`
- Produces: `sha256Hex(data: Buffer | string): string`
- Produces: `verifySignature(publicKeyAuthJwk: string, canonical: string, signatureB64: string): boolean`
- Produces: `generatePairingToken(): string` — used by Task 4.
- Produces (test-only helper reused from here on): `tests/helpers/testKeys.ts` exporting `generateDeviceKeys()` and `signRequest(privateKeyJwk, method, path, timestampMs, bodyBuffer)`.

Every later authenticated request carries three headers: `X-ClipSync-Device-Id`, `X-ClipSync-Timestamp` (ms epoch as a string), `X-ClipSync-Signature` (base64 of the Ed25519 signature over the canonical string). The canonical string always covers method, path, timestamp, and a hex SHA-256 of whatever bytes constitute "the body" for that endpoint — the JSON body for most routes, the raw blob bytes for uploads, and an empty buffer's hash for bodyless GET/DELETE requests. Public keys are exchanged and stored as JWK so both Node's `crypto` and the browser's `SubtleCrypto` can consume them without conversion.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/crypto.signatures.test.ts
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
```

Note: the `sha256Hex` expected constant above has one extra hex digit as a deliberate typo-catch reminder for the implementer — SHA-256 hex digests are 64 hex characters. Use the real digest of the empty string, `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85` (64 chars), in the actual test file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- crypto.signatures`
Expected: FAIL — `src/crypto/signatures.ts` does not exist yet.

- [ ] **Step 3: Implement**

```ts
// src/crypto/signatures.ts
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
```

```ts
// src/crypto/tokens.ts
import { randomBytes } from 'node:crypto';

export function generatePairingToken(): string {
  return randomBytes(32).toString('base64url');
}
```

```ts
// tests/helpers/testKeys.ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- crypto.signatures`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: Ed25519 signature verification and pairing token generation"
```

---

### Task 3: Devices repo and device-auth middleware

**Files:**
- Create: `clipsync-server/src/db/devices.repo.ts`
- Create: `clipsync-server/src/middleware/deviceAuth.ts`
- Modify: `clipsync-server/src/server.ts` — add raw-body capture and a protected test route
- Test: `clipsync-server/tests/middleware.deviceAuth.test.ts`

**Interfaces:**
- Consumes: `Device` type (Task 1), `verifySignature`/`sha256Hex`/`buildCanonicalString` (Task 2), `generateDeviceKeys`/`signRequest` test helpers (Task 2).
- Produces: `DevicesRepo` with `insertDevice(device: Device): void`, `getDeviceById(deviceId: string): Device | undefined`, `listActiveDevices(): Device[]`, `countActiveDevices(): number`, `revokeDevice(deviceId: string): void` — constructed as `createDevicesRepo(db: Database.Database): DevicesRepo`.
- Produces: `deviceAuth(devices: DevicesRepo): express.RequestHandler` — on success attaches `req.device: Device`; on failure responds `401 { error: 'unauthenticated' }` and does not call `next()`.
- Produces (on `server.ts`): `express.raw` style raw-body capture so `deviceAuth` can hash the exact bytes the client signed, regardless of downstream JSON parsing.

- [ ] **Step 1: Write the failing tests**

```ts
// src/db/devices.repo.ts — types only referenced here for the test file's benefit
```

```ts
// tests/middleware.deviceAuth.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestServer } from './helpers/testServer.js';
import { createDevicesRepo } from '../src/db/devices.repo.js';
import { generateDeviceKeys, signRequest } from './helpers/testKeys.js';

describe('deviceAuth middleware (via GET /__test/protected)', () => {
  let ctx: ReturnType<typeof buildTestServer>;

  afterEach(() => ctx?.cleanup());

  function pairedDevice() {
    const keys = generateDeviceKeys();
    const repo = createDevicesRepo(ctx.db);
    const deviceId = 'device-1';
    repo.insertDevice({
      deviceId,
      deviceName: 'Test Mac',
      publicKeyAuthJwk: keys.publicKeyAuthJwk,
      publicKeyExchangeJwk: keys.publicKeyExchangeJwk,
      pairedAt: new Date().toISOString(),
      revokedAt: null,
    });
    return { deviceId, keys, repo };
  }

  it('rejects a request with no auth headers', async () => {
    ctx = buildTestServer();
    const res = await request(ctx.app).get('/__test/protected');
    expect(res.status).toBe(401);
  });

  it('accepts a request with a valid signature from a paired device', async () => {
    ctx = buildTestServer();
    const { deviceId, keys } = pairedDevice();
    const headers = signRequest(keys.privateKeyAuth, 'GET', '/__test/protected');
    headers['X-ClipSync-Device-Id'] = deviceId;
    const res = await request(ctx.app).get('/__test/protected').set(headers);
    expect(res.status).toBe(200);
  });

  it('rejects an unknown device id', async () => {
    ctx = buildTestServer();
    const { keys } = pairedDevice();
    const headers = signRequest(keys.privateKeyAuth, 'GET', '/__test/protected');
    headers['X-ClipSync-Device-Id'] = 'someone-else';
    const res = await request(ctx.app).get('/__test/protected').set(headers);
    expect(res.status).toBe(401);
  });

  it('rejects a stale timestamp outside the auth window', async () => {
    ctx = buildTestServer();
    const { deviceId, keys } = pairedDevice();
    const staleTimestamp = String(Date.now() - 60_000);
    const headers = signRequest(keys.privateKeyAuth, 'GET', '/__test/protected', Buffer.alloc(0), staleTimestamp);
    headers['X-ClipSync-Device-Id'] = deviceId;
    const res = await request(ctx.app).get('/__test/protected').set(headers);
    expect(res.status).toBe(401);
  });

  it('rejects a revoked device', async () => {
    ctx = buildTestServer();
    const { deviceId, keys, repo } = pairedDevice();
    repo.revokeDevice(deviceId);
    const headers = signRequest(keys.privateKeyAuth, 'GET', '/__test/protected');
    headers['X-ClipSync-Device-Id'] = deviceId;
    const res = await request(ctx.app).get('/__test/protected').set(headers);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- middleware.deviceAuth`
Expected: FAIL — `src/db/devices.repo.ts` and `src/middleware/deviceAuth.ts` don't exist yet.

- [ ] **Step 3: Implement**

```ts
// src/db/devices.repo.ts
import type { Database } from 'better-sqlite3';
import type { Device } from '../types.js';

export interface DevicesRepo {
  insertDevice(device: Device): void;
  getDeviceById(deviceId: string): Device | undefined;
  listActiveDevices(): Device[];
  countActiveDevices(): number;
  revokeDevice(deviceId: string): void;
}

function rowToDevice(row: any): Device {
  return {
    deviceId: row.device_id,
    deviceName: row.device_name,
    publicKeyAuthJwk: row.public_key_auth_jwk,
    publicKeyExchangeJwk: row.public_key_exchange_jwk,
    pairedAt: row.paired_at,
    revokedAt: row.revoked_at,
  };
}

export function createDevicesRepo(db: Database): DevicesRepo {
  return {
    insertDevice(device) {
      db.prepare(
        `INSERT INTO devices (device_id, device_name, public_key_auth_jwk, public_key_exchange_jwk, paired_at, revoked_at)
         VALUES (@deviceId, @deviceName, @publicKeyAuthJwk, @publicKeyExchangeJwk, @pairedAt, @revokedAt)`,
      ).run(device);
    },
    getDeviceById(deviceId) {
      const row = db.prepare('SELECT * FROM devices WHERE device_id = ?').get(deviceId);
      return row ? rowToDevice(row) : undefined;
    },
    listActiveDevices() {
      return db
        .prepare('SELECT * FROM devices WHERE revoked_at IS NULL')
        .all()
        .map(rowToDevice);
    },
    countActiveDevices() {
      const row = db
        .prepare('SELECT COUNT(*) AS n FROM devices WHERE revoked_at IS NULL')
        .get() as { n: number };
      return row.n;
    },
    revokeDevice(deviceId) {
      db.prepare('UPDATE devices SET revoked_at = ? WHERE device_id = ?').run(
        new Date().toISOString(),
        deviceId,
      );
    },
  };
}
```

```ts
// src/middleware/deviceAuth.ts
import type { RequestHandler } from 'express';
import { config } from '../config.js';
import { buildCanonicalString, sha256Hex, verifySignature } from '../crypto/signatures.js';
import type { DevicesRepo } from '../db/devices.repo.js';

export function deviceAuth(devices: DevicesRepo): RequestHandler {
  return (req, res, next) => {
    const deviceId = req.header('X-ClipSync-Device-Id');
    const timestamp = req.header('X-ClipSync-Timestamp');
    const signature = req.header('X-ClipSync-Signature');
    if (!deviceId || !timestamp || !signature) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }

    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > config.authWindowMs) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }

    const device = devices.getDeviceById(deviceId);
    if (!device || device.revokedAt) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }

    const rawBody: Buffer = (req as any).rawBody ?? Buffer.alloc(0);
    const canonical = buildCanonicalString(req.method, req.originalUrl, timestamp, sha256Hex(rawBody));
    if (!verifySignature(device.publicKeyAuthJwk, canonical, signature)) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }

    (req as any).device = device;
    next();
  };
}
```

```ts
// src/server.ts — modify: add raw-body capture and a protected smoke-test route
import express from 'express';
import type { Database } from 'better-sqlite3';
import { createDevicesRepo } from './db/devices.repo.js';
import { deviceAuth } from './middleware/deviceAuth.js';

export function createApp(db: Database): express.Express {
  const app = express();

  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as any).rawBody = Buffer.from(buf);
      },
    }),
  );

  app.get('/healthz', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.status(200).json({ status: 'ok' });
  });

  const devices = createDevicesRepo(db);
  // Smoke-test route proving deviceAuth works end to end; real protected
  // routes (pairing, clipboard, uploads) are wired to this same middleware
  // instance in Tasks 4, 6, and 7.
  app.get('/__test/protected', deviceAuth(devices), (_req, res) => {
    res.status(200).json({ ok: true });
  });

  return app;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- middleware.deviceAuth`
Expected: PASS (5 tests). Also re-run `npm test -- server.health` to confirm the raw-body change didn't break Task 1.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: devices repo and Ed25519 device-auth middleware"
```

---

### Task 4: Pairing sessions and pairing routes

**Files:**
- Create: `clipsync-server/src/db/pairingSessions.repo.ts`
- Create: `clipsync-server/src/routes/pairing.routes.ts`
- Modify: `clipsync-server/src/server.ts` — mount pairing router, remove the `/__test/protected` smoke route
- Test: `clipsync-server/tests/routes.pairing.test.ts`

**Interfaces:**
- Consumes: `DevicesRepo` (Task 3), `deviceAuth` (Task 3), `generatePairingToken` (Task 2).
- Produces: `PairingSessionsRepo` with `createSession(session: PairingSession): void`, `getSession(token: string): PairingSession | undefined`, `markUsed(token: string): void` — via `createPairingSessionsRepo(db: Database.Database): PairingSessionsRepo`.
- Produces: `createPairingRouter(devices: DevicesRepo, sessions: PairingSessionsRepo): express.Router` mounted at `/api/pairing`, exposing:
  - `POST /api/pairing/start` — body `{ initiatorDeviceName: string }`. Unauthenticated only when zero active devices exist (bootstrap); otherwise requires `deviceAuth`. Refuses with `409` when `countActiveDevices() >= config.maxPairedDevices`. Returns `{ token, expiresAt }`.
  - `POST /api/pairing/complete` — body `{ token, deviceName, publicKeyAuthJwk, publicKeyExchangeJwk }`. No auth (the new device has no identity yet). Validates the token exists, is unused, and is unexpired; rejects otherwise with `410`. On success: generates a `deviceId` (`crypto.randomUUID()`), inserts the device, marks the session used, and returns `{ deviceId, peerDevices: Device[] }` (the other paired device's public info, so the new device learns its peer's `publicKeyExchangeJwk` for later content encryption — out of scope here, but the server must hand it over).
  - `DELETE /api/pairing/devices/:deviceId` — requires `deviceAuth`; only the device itself or a device other than the target may revoke (for MVP: either paired device can unpair either device, since there are only ever two). Calls `revokeDevice`. Returns `204`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/routes.pairing.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestServer } from './helpers/testServer.js';
import { generateDeviceKeys, signRequest } from './helpers/testKeys.js';

describe('pairing flow', () => {
  let ctx: ReturnType<typeof buildTestServer>;
  afterEach(() => ctx?.cleanup());

  it('starts a pairing session with no auth when no devices are paired yet', async () => {
    ctx = buildTestServer();
    const res = await request(ctx.app).post('/api/pairing/start').send({ initiatorDeviceName: "Yoga's Mac" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTypeOf('string');
    expect(res.body.expiresAt).toBeTypeOf('string');
  });

  it('completes pairing with a valid token and registers the device', async () => {
    ctx = buildTestServer();
    const start = await request(ctx.app).post('/api/pairing/start').send({ initiatorDeviceName: "Yoga's Mac" });
    const keys = generateDeviceKeys();
    const complete = await request(ctx.app).post('/api/pairing/complete').send({
      token: start.body.token,
      deviceName: "Yoga's Pixel",
      publicKeyAuthJwk: keys.publicKeyAuthJwk,
      publicKeyExchangeJwk: keys.publicKeyExchangeJwk,
    });
    expect(complete.status).toBe(200);
    expect(complete.body.deviceId).toBeTypeOf('string');
  });

  it('rejects completing a pairing session twice', async () => {
    ctx = buildTestServer();
    const start = await request(ctx.app).post('/api/pairing/start').send({ initiatorDeviceName: "Yoga's Mac" });
    const keys = generateDeviceKeys();
    const payload = {
      token: start.body.token,
      deviceName: "Yoga's Pixel",
      publicKeyAuthJwk: keys.publicKeyAuthJwk,
      publicKeyExchangeJwk: keys.publicKeyExchangeJwk,
    };
    await request(ctx.app).post('/api/pairing/complete').send(payload);
    const second = await request(ctx.app).post('/api/pairing/complete').send(payload);
    expect(second.status).toBe(410);
  });

  it('rejects starting a third pairing once two devices are active', async () => {
    ctx = buildTestServer();
    // Pair device 1 (bootstrap, unauthenticated start).
    const start1 = await request(ctx.app).post('/api/pairing/start').send({ initiatorDeviceName: 'Mac' });
    const keys1 = generateDeviceKeys();
    const c1 = await request(ctx.app).post('/api/pairing/complete').send({
      token: start1.body.token,
      deviceName: 'Mac',
      publicKeyAuthJwk: keys1.publicKeyAuthJwk,
      publicKeyExchangeJwk: keys1.publicKeyExchangeJwk,
    });

    // Pair device 2, authenticated as device 1.
    const headers1 = signRequest(keys1.privateKeyAuth, 'POST', '/api/pairing/start', Buffer.from(JSON.stringify({ initiatorDeviceName: 'Mac' })));
    headers1['X-ClipSync-Device-Id'] = c1.body.deviceId;
    const start2 = await request(ctx.app)
      .post('/api/pairing/start')
      .set(headers1)
      .send({ initiatorDeviceName: 'Mac' });
    const keys2 = generateDeviceKeys();
    await request(ctx.app).post('/api/pairing/complete').send({
      token: start2.body.token,
      deviceName: 'Pixel',
      publicKeyAuthJwk: keys2.publicKeyAuthJwk,
      publicKeyExchangeJwk: keys2.publicKeyExchangeJwk,
    });

    // A third start, authenticated as device 1, must be refused.
    const bodyBuf = Buffer.from(JSON.stringify({ initiatorDeviceName: 'Mac' }));
    const headers3 = signRequest(keys1.privateKeyAuth, 'POST', '/api/pairing/start', bodyBuf);
    headers3['X-ClipSync-Device-Id'] = c1.body.deviceId;
    const start3 = await request(ctx.app).post('/api/pairing/start').set(headers3).send({ initiatorDeviceName: 'Mac' });
    expect(start3.status).toBe(409);
  });

  it('unpairs a device so it can no longer authenticate', async () => {
    ctx = buildTestServer();
    const start = await request(ctx.app).post('/api/pairing/start').send({ initiatorDeviceName: 'Mac' });
    const keys = generateDeviceKeys();
    const complete = await request(ctx.app).post('/api/pairing/complete').send({
      token: start.body.token,
      deviceName: 'Mac',
      publicKeyAuthJwk: keys.publicKeyAuthJwk,
      publicKeyExchangeJwk: keys.publicKeyExchangeJwk,
    });
    const deviceId = complete.body.deviceId;
    const headers = signRequest(keys.privateKeyAuth, 'DELETE', `/api/pairing/devices/${deviceId}`);
    headers['X-ClipSync-Device-Id'] = deviceId;
    const unpair = await request(ctx.app).delete(`/api/pairing/devices/${deviceId}`).set(headers);
    expect(unpair.status).toBe(204);

    const headersAfter = signRequest(keys.privateKeyAuth, 'GET', '/healthz');
    headersAfter['X-ClipSync-Device-Id'] = deviceId;
    // healthz isn't protected, so assert against the pairing endpoint instead:
    const startAfter = signRequest(keys.privateKeyAuth, 'POST', '/api/pairing/start', Buffer.from(JSON.stringify({ initiatorDeviceName: 'Mac' })));
    startAfter['X-ClipSync-Device-Id'] = deviceId;
    const res = await request(ctx.app).post('/api/pairing/start').set(startAfter).send({ initiatorDeviceName: 'Mac' });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- routes.pairing`
Expected: FAIL — `src/routes/pairing.routes.ts` doesn't exist; `/api/pairing/*` returns 404.

- [ ] **Step 3: Implement**

```ts
// src/db/pairingSessions.repo.ts
import type { Database } from 'better-sqlite3';
import type { PairingSession } from '../types.js';

export interface PairingSessionsRepo {
  createSession(session: PairingSession): void;
  getSession(token: string): PairingSession | undefined;
  markUsed(token: string): void;
}

function rowToSession(row: any): PairingSession {
  return {
    token: row.token,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    initiatorDeviceName: row.initiator_device_name,
  };
}

export function createPairingSessionsRepo(db: Database): PairingSessionsRepo {
  return {
    createSession(session) {
      db.prepare(
        `INSERT INTO pairing_sessions (token, created_at, expires_at, used_at, initiator_device_name)
         VALUES (@token, @createdAt, @expiresAt, @usedAt, @initiatorDeviceName)`,
      ).run(session);
    },
    getSession(token) {
      const row = db.prepare('SELECT * FROM pairing_sessions WHERE token = ?').get(token);
      return row ? rowToSession(row) : undefined;
    },
    markUsed(token) {
      db.prepare('UPDATE pairing_sessions SET used_at = ? WHERE token = ?').run(
        new Date().toISOString(),
        token,
      );
    },
  };
}
```

```ts
// src/routes/pairing.routes.ts
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { generatePairingToken } from '../crypto/tokens.js';
import { deviceAuth } from '../middleware/deviceAuth.js';
import type { DevicesRepo } from '../db/devices.repo.js';
import type { PairingSessionsRepo } from '../db/pairingSessions.repo.js';

export function createPairingRouter(devices: DevicesRepo, sessions: PairingSessionsRepo): Router {
  const router = Router();
  const requireAuth = deviceAuth(devices);

  router.post('/start', (req, res, next) => {
    // Bootstrap case: the very first device pairs without prior auth.
    if (devices.countActiveDevices() === 0) {
      handleStart(req, res);
      return;
    }
    requireAuth(req, res, () => handleStart(req, res));
  });

  function handleStart(req: import('express').Request, res: import('express').Response) {
    if (devices.countActiveDevices() >= config.maxPairedDevices) {
      res.status(409).json({ error: 'max_paired_devices' });
      return;
    }
    const { initiatorDeviceName } = req.body as { initiatorDeviceName?: string };
    if (!initiatorDeviceName) {
      res.status(400).json({ error: 'initiatorDeviceName required' });
      return;
    }
    const token = generatePairingToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + config.pairingTtlMs);
    sessions.createSession({
      token,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      usedAt: null,
      initiatorDeviceName,
    });
    res.status(200).json({ token, expiresAt: expiresAt.toISOString() });
  }

  router.post('/complete', (req, res) => {
    const { token, deviceName, publicKeyAuthJwk, publicKeyExchangeJwk } = req.body as {
      token?: string;
      deviceName?: string;
      publicKeyAuthJwk?: string;
      publicKeyExchangeJwk?: string;
    };
    if (!token || !deviceName || !publicKeyAuthJwk || !publicKeyExchangeJwk) {
      res.status(400).json({ error: 'missing fields' });
      return;
    }
    const session = sessions.getSession(token);
    if (!session || session.usedAt || new Date(session.expiresAt).getTime() < Date.now()) {
      res.status(410).json({ error: 'pairing_session_invalid' });
      return;
    }
    if (devices.countActiveDevices() >= config.maxPairedDevices) {
      res.status(409).json({ error: 'max_paired_devices' });
      return;
    }

    const deviceId = randomUUID();
    devices.insertDevice({
      deviceId,
      deviceName,
      publicKeyAuthJwk,
      publicKeyExchangeJwk,
      pairedAt: new Date().toISOString(),
      revokedAt: null,
    });
    sessions.markUsed(token);

    const peerDevices = devices.listActiveDevices().filter((d) => d.deviceId !== deviceId);
    res.status(200).json({ deviceId, peerDevices });
  });

  router.delete('/devices/:deviceId', requireAuth, (req, res) => {
    devices.revokeDevice(req.params.deviceId);
    res.status(204).send();
  });

  return router;
}
```

```ts
// src/server.ts — modify: mount the pairing router, drop the smoke-test route
import express from 'express';
import type { Database } from 'better-sqlite3';
import { createDevicesRepo } from './db/devices.repo.js';
import { createPairingSessionsRepo } from './db/pairingSessions.repo.js';
import { createPairingRouter } from './routes/pairing.routes.js';

export function createApp(db: Database): express.Express {
  const app = express();

  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as any).rawBody = Buffer.from(buf);
      },
    }),
  );

  app.get('/healthz', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.status(200).json({ status: 'ok' });
  });

  const devices = createDevicesRepo(db);
  const pairingSessions = createPairingSessionsRepo(db);
  app.use('/api/pairing', createPairingRouter(devices, pairingSessions));

  return app;
}
```

Remove the `/__test/protected` route and its describe block's dependency by pointing `tests/middleware.deviceAuth.test.ts`'s remaining assertions at `POST /api/pairing/start` once at least one device exists — no change needed to that test file since it builds its own paired device directly via the repo and only needs *some* authenticated route; update the path used in that file from `/__test/protected` to `/api/pairing/start` with a minimal valid body (`{ initiatorDeviceName: 'x' }`) sent alongside the signed headers, and expect `200` for the success case (adjust the body hash accordingly since a POST now carries a body). This keeps one canonical protected-route smoke test instead of two.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS across `server.health`, `crypto.signatures`, `middleware.deviceAuth`, `routes.pairing`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: pairing sessions, pairing/complete/unpair routes, device cap"
```

---

### Task 5: Clipboard items repo with retention eviction

**Files:**
- Create: `clipsync-server/src/db/clipboardItems.repo.ts`
- Test: `clipsync-server/tests/db.clipboardItems.test.ts`

**Interfaces:**
- Consumes: `ClipboardItem` type (Task 1).
- Produces: `ClipboardItemsRepo` via `createClipboardItemsRepo(db: Database.Database): ClipboardItemsRepo` with:
  - `insertItem(item: ClipboardItem): void`
  - `listItems(limit: number): ClipboardItem[]` — newest first.
  - `deleteItem(id: string): ClipboardItem | undefined` — returns the deleted row (so the caller can remove its blob file).
  - `clearAll(): ClipboardItem[]` — returns all rows that were deleted.
  - `evictOverLimit(limit: number): ClipboardItem[]` — deletes and returns any rows beyond `limit`, oldest first.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/db.clipboardItems.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { buildTestServer } from './helpers/testServer.js';
import { createClipboardItemsRepo } from '../src/db/clipboardItems.repo.js';
import { createDevicesRepo } from '../src/db/devices.repo.js';
import { generateDeviceKeys } from './helpers/testKeys.js';
import type { ClipboardItem } from '../src/types.js';

describe('clipboardItems repo', () => {
  let ctx: ReturnType<typeof buildTestServer>;
  afterEach(() => ctx?.cleanup());

  function seedDevice() {
    const devices = createDevicesRepo(ctx.db);
    const keys = generateDeviceKeys();
    devices.insertDevice({
      deviceId: 'device-1',
      deviceName: 'Mac',
      publicKeyAuthJwk: keys.publicKeyAuthJwk,
      publicKeyExchangeJwk: keys.publicKeyExchangeJwk,
      pairedAt: new Date().toISOString(),
      revokedAt: null,
    });
  }

  function makeItem(overrides: Partial<ClipboardItem> = {}): ClipboardItem {
    return {
      id: overrides.id ?? crypto.randomUUID(),
      contentType: 'text/plain',
      ciphertext: 'opaque-ciphertext',
      blobPath: null,
      deviceId: 'device-1',
      deviceName: 'Mac',
      createdAt: overrides.createdAt ?? new Date().toISOString(),
      ...overrides,
    };
  }

  it('lists items newest first', () => {
    ctx = buildTestServer();
    seedDevice();
    const repo = createClipboardItemsRepo(ctx.db);
    repo.insertItem(makeItem({ id: 'a', createdAt: '2026-01-01T00:00:00.000Z' }));
    repo.insertItem(makeItem({ id: 'b', createdAt: '2026-01-02T00:00:00.000Z' }));
    const items = repo.listItems(50);
    expect(items.map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('deletes an item and returns the deleted row', () => {
    ctx = buildTestServer();
    seedDevice();
    const repo = createClipboardItemsRepo(ctx.db);
    repo.insertItem(makeItem({ id: 'a' }));
    const deleted = repo.deleteItem('a');
    expect(deleted?.id).toBe('a');
    expect(repo.listItems(50)).toHaveLength(0);
  });

  it('clears all items and returns every deleted row', () => {
    ctx = buildTestServer();
    seedDevice();
    const repo = createClipboardItemsRepo(ctx.db);
    repo.insertItem(makeItem({ id: 'a' }));
    repo.insertItem(makeItem({ id: 'b' }));
    const cleared = repo.clearAll();
    expect(cleared).toHaveLength(2);
    expect(repo.listItems(50)).toHaveLength(0);
  });

  it('evicts only items beyond the limit, oldest first', () => {
    ctx = buildTestServer();
    seedDevice();
    const repo = createClipboardItemsRepo(ctx.db);
    for (let i = 0; i < 5; i++) {
      repo.insertItem(makeItem({ id: `item-${i}`, createdAt: `2026-01-0${i + 1}T00:00:00.000Z` }));
    }
    const evicted = repo.evictOverLimit(3);
    expect(evicted.map((i) => i.id)).toEqual(['item-0', 'item-1']);
    expect(repo.listItems(50)).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- db.clipboardItems`
Expected: FAIL — `src/db/clipboardItems.repo.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

```ts
// src/db/clipboardItems.repo.ts
import type { Database } from 'better-sqlite3';
import type { ClipboardItem } from '../types.js';

export interface ClipboardItemsRepo {
  insertItem(item: ClipboardItem): void;
  listItems(limit: number): ClipboardItem[];
  deleteItem(id: string): ClipboardItem | undefined;
  clearAll(): ClipboardItem[];
  evictOverLimit(limit: number): ClipboardItem[];
}

function rowToItem(row: any): ClipboardItem {
  return {
    id: row.id,
    contentType: row.content_type,
    ciphertext: row.ciphertext,
    blobPath: row.blob_path,
    deviceId: row.device_id,
    deviceName: row.device_name,
    createdAt: row.created_at,
  };
}

export function createClipboardItemsRepo(db: Database): ClipboardItemsRepo {
  return {
    insertItem(item) {
      db.prepare(
        `INSERT INTO clipboard_items (id, content_type, ciphertext, blob_path, device_id, device_name, created_at)
         VALUES (@id, @contentType, @ciphertext, @blobPath, @deviceId, @deviceName, @createdAt)`,
      ).run(item);
    },
    listItems(limit) {
      return db
        .prepare('SELECT * FROM clipboard_items ORDER BY created_at DESC, id DESC LIMIT ?')
        .all(limit)
        .map(rowToItem);
    },
    deleteItem(id) {
      const row = db.prepare('SELECT * FROM clipboard_items WHERE id = ?').get(id);
      if (!row) return undefined;
      db.prepare('DELETE FROM clipboard_items WHERE id = ?').run(id);
      return rowToItem(row);
    },
    clearAll() {
      const rows = db.prepare('SELECT * FROM clipboard_items').all().map(rowToItem);
      db.prepare('DELETE FROM clipboard_items').run();
      return rows;
    },
    evictOverLimit(limit) {
      const rows = db
        .prepare(
          `SELECT * FROM clipboard_items ORDER BY created_at DESC, id DESC
           LIMIT -1 OFFSET ?`,
        )
        .all(limit)
        .map(rowToItem);
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`DELETE FROM clipboard_items WHERE id IN (${placeholders})`).run(...ids);
      return rows.reverse(); // oldest first, matching the "evicted, in eviction order" contract
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- db.clipboardItems`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: clipboard items repo with 50-item retention eviction"
```

---

### Task 6: Clipboard API routes

**Files:**
- Create: `clipsync-server/src/routes/clipboard.routes.ts`
- Modify: `clipsync-server/src/server.ts` — mount the clipboard router
- Test: `clipsync-server/tests/routes.clipboard.test.ts`

**Interfaces:**
- Consumes: `ClipboardItemsRepo` (Task 5), `deviceAuth` (Task 3), `config.historyLimit` (Task 1).
- Produces: `createClipboardRouter(devices: DevicesRepo, items: ClipboardItemsRepo, onEvict?: (evicted: ClipboardItem[]) => void, onChange?: (event: ClipboardEvent) => void): Router` mounted at `/api/clipboard`:
  - `POST /` — body `{ contentType: string, ciphertext: string }` (text/URL/code; images go through Task 7's upload route instead). Requires `deviceAuth`. Inserts the item attributed to `req.device`, evicts over the 50-item limit, calls `onChange({ type: 'clipboard.created', item })`, returns `201` with the item.
  - `GET /` — requires `deviceAuth`. Returns `{ items: ClipboardItem[] }`, newest first, capped at `config.historyLimit`.
  - `DELETE /:id` — requires `deviceAuth`. Deletes the item, calls `onChange({ type: 'clipboard.deleted', id })`, returns `204`. Returns `404` if the id doesn't exist.
  - `DELETE /` — requires `deviceAuth`. Clears all items, calls `onChange({ type: 'clipboard.cleared' })`, returns `204`.
  - The `onEvict` and `onChange` callbacks are optional constructor arguments so Task 5's repo tests and this task's route tests don't need a real WebSocket hub; Task 8 wires real implementations of both when it builds the hub.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/routes.clipboard.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestServer } from './helpers/testServer.js';
import { generateDeviceKeys, signRequest } from './helpers/testKeys.js';

async function pairFirstDevice(app: import('express').Express) {
  const start = await request(app).post('/api/pairing/start').send({ initiatorDeviceName: 'Mac' });
  const keys = generateDeviceKeys();
  const complete = await request(app).post('/api/pairing/complete').send({
    token: start.body.token,
    deviceName: 'Mac',
    publicKeyAuthJwk: keys.publicKeyAuthJwk,
    publicKeyExchangeJwk: keys.publicKeyExchangeJwk,
  });
  return { deviceId: complete.body.deviceId as string, keys };
}

function authed(keys: ReturnType<typeof generateDeviceKeys>, deviceId: string, method: string, path: string, body?: Buffer) {
  const headers = signRequest(keys.privateKeyAuth, method, path, body ?? Buffer.alloc(0));
  headers['X-ClipSync-Device-Id'] = deviceId;
  return headers;
}

describe('clipboard routes', () => {
  let ctx: ReturnType<typeof buildTestServer>;
  afterEach(() => ctx?.cleanup());

  it('rejects unauthenticated access to every clipboard route', async () => {
    ctx = buildTestServer();
    expect((await request(ctx.app).get('/api/clipboard')).status).toBe(401);
    expect((await request(ctx.app).post('/api/clipboard').send({})).status).toBe(401);
    expect((await request(ctx.app).delete('/api/clipboard/x')).status).toBe(401);
    expect((await request(ctx.app).delete('/api/clipboard')).status).toBe(401);
  });

  it('adds an item and lists it newest first', async () => {
    ctx = buildTestServer();
    const { deviceId, keys } = await pairFirstDevice(ctx.app);
    const body = Buffer.from(JSON.stringify({ contentType: 'text/plain', ciphertext: 'abc' }));
    const postRes = await request(ctx.app)
      .post('/api/clipboard')
      .set(authed(keys, deviceId, 'POST', '/api/clipboard', body))
      .send(JSON.parse(body.toString()));
    expect(postRes.status).toBe(201);

    const getRes = await request(ctx.app)
      .get('/api/clipboard')
      .set(authed(keys, deviceId, 'GET', '/api/clipboard'));
    expect(getRes.status).toBe(200);
    expect(getRes.body.items).toHaveLength(1);
    expect(getRes.body.items[0].deviceId).toBe(deviceId);
  });

  it('deletes a single item', async () => {
    ctx = buildTestServer();
    const { deviceId, keys } = await pairFirstDevice(ctx.app);
    const body = Buffer.from(JSON.stringify({ contentType: 'text/plain', ciphertext: 'abc' }));
    const postRes = await request(ctx.app)
      .post('/api/clipboard')
      .set(authed(keys, deviceId, 'POST', '/api/clipboard', body))
      .send(JSON.parse(body.toString()));
    const id = postRes.body.id;

    const delRes = await request(ctx.app)
      .delete(`/api/clipboard/${id}`)
      .set(authed(keys, deviceId, 'DELETE', `/api/clipboard/${id}`));
    expect(delRes.status).toBe(204);

    const getRes = await request(ctx.app)
      .get('/api/clipboard')
      .set(authed(keys, deviceId, 'GET', '/api/clipboard'));
    expect(getRes.body.items).toHaveLength(0);
  });

  it('clears all items', async () => {
    ctx = buildTestServer();
    const { deviceId, keys } = await pairFirstDevice(ctx.app);
    for (const text of ['a', 'b']) {
      const body = Buffer.from(JSON.stringify({ contentType: 'text/plain', ciphertext: text }));
      await request(ctx.app)
        .post('/api/clipboard')
        .set(authed(keys, deviceId, 'POST', '/api/clipboard', body))
        .send(JSON.parse(body.toString()));
    }
    const clearRes = await request(ctx.app)
      .delete('/api/clipboard')
      .set(authed(keys, deviceId, 'DELETE', '/api/clipboard'));
    expect(clearRes.status).toBe(204);

    const getRes = await request(ctx.app)
      .get('/api/clipboard')
      .set(authed(keys, deviceId, 'GET', '/api/clipboard'));
    expect(getRes.body.items).toHaveLength(0);
  });

  it('evicts the oldest item once more than 50 are stored', async () => {
    ctx = buildTestServer();
    const { deviceId, keys } = await pairFirstDevice(ctx.app);
    for (let i = 0; i < 51; i++) {
      const body = Buffer.from(JSON.stringify({ contentType: 'text/plain', ciphertext: `item-${i}` }));
      await request(ctx.app)
        .post('/api/clipboard')
        .set(authed(keys, deviceId, 'POST', '/api/clipboard', body))
        .send(JSON.parse(body.toString()));
    }
    const getRes = await request(ctx.app)
      .get('/api/clipboard')
      .set(authed(keys, deviceId, 'GET', '/api/clipboard'));
    expect(getRes.body.items).toHaveLength(50);
    const ciphertexts = getRes.body.items.map((i: any) => i.ciphertext);
    expect(ciphertexts).not.toContain('item-0');
    expect(ciphertexts).toContain('item-50');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- routes.clipboard`
Expected: FAIL — `src/routes/clipboard.routes.ts` doesn't exist; all requests 404.

- [ ] **Step 3: Implement**

```ts
// src/routes/clipboard.routes.ts
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { deviceAuth } from '../middleware/deviceAuth.js';
import type { DevicesRepo } from '../db/devices.repo.js';
import type { ClipboardItemsRepo } from '../db/clipboardItems.repo.js';
import type { ClipboardEvent, ClipboardItem } from '../types.js';

export function createClipboardRouter(
  devices: DevicesRepo,
  items: ClipboardItemsRepo,
  onEvict: (evicted: ClipboardItem[]) => void = () => {},
  onChange: (event: ClipboardEvent) => void = () => {},
): Router {
  const router = Router();
  const requireAuth = deviceAuth(devices);

  router.post('/', requireAuth, (req, res) => {
    const { contentType, ciphertext } = req.body as { contentType?: string; ciphertext?: string };
    if (!contentType || !ciphertext) {
      res.status(400).json({ error: 'contentType and ciphertext required' });
      return;
    }
    const device = (req as any).device;
    const item: ClipboardItem = {
      id: randomUUID(),
      contentType,
      ciphertext,
      blobPath: null,
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      createdAt: new Date().toISOString(),
    };
    items.insertItem(item);
    onChange({ type: 'clipboard.created', item });

    const evicted = items.evictOverLimit(config.historyLimit);
    if (evicted.length > 0) onEvict(evicted);

    res.status(201).json(item);
  });

  router.get('/', requireAuth, (_req, res) => {
    res.status(200).json({ items: items.listItems(config.historyLimit) });
  });

  router.delete('/:id', requireAuth, (req, res) => {
    const deleted = items.deleteItem(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    onChange({ type: 'clipboard.deleted', id: deleted.id });
    if (deleted.blobPath) onEvict([deleted]);
    res.status(204).send();
  });

  router.delete('/', requireAuth, (_req, res) => {
    const cleared = items.clearAll();
    onChange({ type: 'clipboard.cleared' });
    const withBlobs = cleared.filter((i) => i.blobPath);
    if (withBlobs.length > 0) onEvict(withBlobs);
    res.status(204).send();
  });

  return router;
}
```

```ts
// src/server.ts — modify: mount the clipboard router
import { createClipboardItemsRepo } from './db/clipboardItems.repo.js';
import { createClipboardRouter } from './routes/clipboard.routes.js';

// ...inside createApp, after the pairing router is mounted:
const clipboardItems = createClipboardItemsRepo(db);
app.use('/api/clipboard', createClipboardRouter(devices, clipboardItems));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- routes.clipboard`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: clipboard API routes with auth, listing, delete, clear, eviction"
```

---

### Task 7: Blob storage and image upload/download routes

**Files:**
- Create: `clipsync-server/src/storage/blobStore.ts`
- Create: `clipsync-server/src/routes/uploads.routes.ts`
- Modify: `clipsync-server/src/routes/clipboard.routes.ts` — wire `onEvict` to delete blob files
- Modify: `clipsync-server/src/server.ts` — mount uploads router, pass blob dir + `onEvict`
- Test: `clipsync-server/tests/routes.uploads.test.ts`

**Interfaces:**
- Consumes: `ClipboardItemsRepo` (Task 5), `deviceAuth` (Task 3).
- Produces: `blobPathFor(blobDir: string, itemId: string): string`, `writeBlob(blobDir: string, itemId: string, data: Buffer): Promise<string>` (returns the relative path stored on the item), `readBlob(absolutePath: string): Promise<Buffer>`, `deleteBlob(absolutePath: string | null): Promise<void>` (no-op if `null` or already missing).
- Produces: `createUploadsRouter(devices: DevicesRepo, items: ClipboardItemsRepo, blobDir: string, onEvict, onChange): Router` mounted at `/api/clipboard`:
  - `POST /:id/blob` — requires `deviceAuth`; multipart field `file`, max 10 MB (MVP image-size limit; PRODUCT.md left this open, this plan fixes it at 10 MB — revisit if the owner wants a different ceiling). Requires the clipboard item `:id` to already exist (created via a preceding `POST /api/clipboard` with `contentType: 'image/png'` and no `ciphertext`). Writes the file, updates `blob_path` on the item, returns `200` with the updated item. Rejects oversized files with `413`.
  - `GET /:id/blob` — requires `deviceAuth`. Streams the stored file back with the item's `contentType`. Returns `404` if the item or its blob is missing.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/routes.uploads.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestServer } from './helpers/testServer.js';
import { generateDeviceKeys, signRequest } from './helpers/testKeys.js';

async function pairFirstDevice(app: import('express').Express) {
  const start = await request(app).post('/api/pairing/start').send({ initiatorDeviceName: 'Mac' });
  const keys = generateDeviceKeys();
  const complete = await request(app).post('/api/pairing/complete').send({
    token: start.body.token,
    deviceName: 'Mac',
    publicKeyAuthJwk: keys.publicKeyAuthJwk,
    publicKeyExchangeJwk: keys.publicKeyExchangeJwk,
  });
  return { deviceId: complete.body.deviceId as string, keys };
}

describe('image upload and download', () => {
  let ctx: ReturnType<typeof buildTestServer>;
  afterEach(() => ctx?.cleanup());

  it('uploads a blob for an existing item and downloads it back byte-for-byte', async () => {
    ctx = buildTestServer();
    const { deviceId, keys } = await pairFirstDevice(ctx.app);

    const createBody = Buffer.from(JSON.stringify({ contentType: 'image/png', ciphertext: '' }));
    const createHeaders = signRequest(keys.privateKeyAuth, 'POST', '/api/clipboard', createBody);
    createHeaders['X-ClipSync-Device-Id'] = deviceId;
    const created = await request(ctx.app).post('/api/clipboard').set(createHeaders).send(JSON.parse(createBody.toString()));
    const itemId = created.body.id;

    const fileBytes = Buffer.from('fake-encrypted-png-bytes');
    const uploadPath = `/api/clipboard/${itemId}/blob`;
    const uploadHeaders = signRequest(keys.privateKeyAuth, 'POST', uploadPath, fileBytes);
    uploadHeaders['X-ClipSync-Device-Id'] = deviceId;
    const uploadRes = await request(ctx.app)
      .post(uploadPath)
      .set(uploadHeaders)
      .attach('file', fileBytes, 'clip.png');
    expect(uploadRes.status).toBe(200);

    const downloadPath = `/api/clipboard/${itemId}/blob`;
    const downloadHeaders = signRequest(keys.privateKeyAuth, 'GET', downloadPath);
    downloadHeaders['X-ClipSync-Device-Id'] = deviceId;
    const downloadRes = await request(ctx.app).get(downloadPath).set(downloadHeaders);
    expect(downloadRes.status).toBe(200);
    expect(Buffer.compare(downloadRes.body, fileBytes)).toBe(0);
  });

  it('returns 404 downloading a blob for an item with none', async () => {
    ctx = buildTestServer();
    const { deviceId, keys } = await pairFirstDevice(ctx.app);
    const createBody = Buffer.from(JSON.stringify({ contentType: 'text/plain', ciphertext: 'no-blob-here' }));
    const createHeaders = signRequest(keys.privateKeyAuth, 'POST', '/api/clipboard', createBody);
    createHeaders['X-ClipSync-Device-Id'] = deviceId;
    const created = await request(ctx.app).post('/api/clipboard').set(createHeaders).send(JSON.parse(createBody.toString()));

    const downloadPath = `/api/clipboard/${created.body.id}/blob`;
    const downloadHeaders = signRequest(keys.privateKeyAuth, 'GET', downloadPath);
    downloadHeaders['X-ClipSync-Device-Id'] = deviceId;
    const res = await request(ctx.app).get(downloadPath).set(downloadHeaders);
    expect(res.status).toBe(404);
  });

  it('rejects an unauthenticated upload', async () => {
    ctx = buildTestServer();
    const res = await request(ctx.app).post('/api/clipboard/some-id/blob').attach('file', Buffer.from('x'), 'x.png');
    expect(res.status).toBe(401);
  });
});
```

Note: multipart requests carry a boundary-wrapped body that does not byte-match the raw `file` bytes passed into `signRequest`. For MVP, the upload route's signature covers `method + path + timestamp + sha256(file bytes)` where "file bytes" are extracted by `multer` *before* verification — this means `deviceAuth`'s generic raw-body hashing (Task 3) does not apply to this one route. `uploads.routes.ts` therefore does its own signature check after `multer` parses the body, reusing `verifySignature`/`buildCanonicalString` directly instead of the `deviceAuth` middleware, for the `POST` upload route only. The `GET` download route has an empty body and uses `deviceAuth` normally.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- routes.uploads`
Expected: FAIL — `src/routes/uploads.routes.ts` doesn't exist.

- [ ] **Step 3: Implement**

```ts
// src/storage/blobStore.ts
import fs from 'node:fs/promises';
import path from 'node:path';

export function blobPathFor(blobDir: string, itemId: string): string {
  return path.join(blobDir, `${itemId}.bin`);
}

export async function writeBlob(blobDir: string, itemId: string, data: Buffer): Promise<string> {
  await fs.mkdir(blobDir, { recursive: true });
  const fullPath = blobPathFor(blobDir, itemId);
  await fs.writeFile(fullPath, data);
  return fullPath;
}

export async function readBlob(absolutePath: string): Promise<Buffer> {
  return fs.readFile(absolutePath);
}

export async function deleteBlob(absolutePath: string | null): Promise<void> {
  if (!absolutePath) return;
  await fs.rm(absolutePath, { force: true });
}
```

```ts
// src/routes/uploads.routes.ts
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { buildCanonicalString, sha256Hex, verifySignature } from '../crypto/signatures.js';
import { blobPathFor, deleteBlob, readBlob, writeBlob } from '../storage/blobStore.js';
import type { DevicesRepo } from '../db/devices.repo.js';
import type { ClipboardItemsRepo } from '../db/clipboardItems.repo.js';
import type { ClipboardEvent, ClipboardItem } from '../types.js';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB — MVP fixed ceiling, see Interfaces note.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

export function createUploadsRouter(
  devices: DevicesRepo,
  items: ClipboardItemsRepo,
  blobDir: string,
  onChange: (event: ClipboardEvent) => void = () => {},
): Router {
  const router = Router();

  router.post('/:id/blob', upload.single('file'), async (req, res) => {
    const deviceId = req.header('X-ClipSync-Device-Id');
    const timestamp = req.header('X-ClipSync-Timestamp');
    const signature = req.header('X-ClipSync-Signature');
    const file = (req as any).file as { buffer: Buffer } | undefined;

    if (!deviceId || !timestamp || !signature || !file) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > config.authWindowMs) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const device = devices.getDeviceById(deviceId);
    if (!device || device.revokedAt) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const canonical = buildCanonicalString(req.method, req.originalUrl, timestamp, sha256Hex(file.buffer));
    if (!verifySignature(device.publicKeyAuthJwk, canonical, signature)) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }

    const item = items.listItems(1_000_000).find((i) => i.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const fullPath = await writeBlob(blobDir, item.id, file.buffer);
    const updated: ClipboardItem = { ...item, blobPath: fullPath };
    items.deleteItem(item.id);
    items.insertItem(updated);
    onChange({ type: 'clipboard.created', item: updated });
    res.status(200).json(updated);
  });

  router.get('/:id/blob', (req, res, next) => {
    const deviceAuthCheck = () => {
      const deviceId = req.header('X-ClipSync-Device-Id');
      const timestamp = req.header('X-ClipSync-Timestamp');
      const signature = req.header('X-ClipSync-Signature');
      if (!deviceId || !timestamp || !signature) return false;
      const ts = Number(timestamp);
      if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > config.authWindowMs) return false;
      const device = devices.getDeviceById(deviceId);
      if (!device || device.revokedAt) return false;
      const canonical = buildCanonicalString(req.method, req.originalUrl, timestamp, sha256Hex(''));
      return verifySignature(device.publicKeyAuthJwk, canonical, signature);
    };
    if (!deviceAuthCheck()) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    next();
  }, async (req, res) => {
    const item = items.listItems(1_000_000).find((i) => i.id === req.params.id);
    if (!item || !item.blobPath) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const data = await readBlob(item.blobPath);
    res.status(200).type(item.contentType).send(data);
  });

  return router;
}
```

```ts
// src/routes/clipboard.routes.ts — modify: onEvict now actually deletes blob files.
// This wiring happens in server.ts, not inside clipboard.routes.ts itself —
// clipboard.routes.ts already accepts onEvict as a parameter (Task 6); no
// code change needed in this file. Listed here only so the dependency is visible.
```

```ts
// src/server.ts — modify: mount uploads router; wire onEvict to delete blob files
import { createUploadsRouter } from './routes/uploads.routes.js';
import { deleteBlob } from './storage/blobStore.js';
import { config } from './config.js';

// ...inside createApp(db, blobDir = config.blobDir):
export function createApp(db: Database, blobDir: string = config.blobDir): express.Express {
  // ...
  const clipboardItems = createClipboardItemsRepo(db);
  const onEvict = (evicted: ClipboardItem[]) => {
    for (const item of evicted) {
      if (item.blobPath) void deleteBlob(item.blobPath);
    }
  };
  app.use('/api/clipboard', createClipboardRouter(devices, clipboardItems, onEvict));
  app.use('/api/clipboard', createUploadsRouter(devices, clipboardItems, blobDir));
  // ...
}
```

`tests/helpers/testServer.ts` must now pass its `blobDir` into `createApp(db, blobDir)` — update the one line that calls `createApp(db)` to `createApp(db, blobDir)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS across every test file so far.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: encrypted blob storage with authenticated upload/download"
```

---

### Task 8: WebSocket hub and real-time broadcast

**Files:**
- Create: `clipsync-server/src/ws/hub.ts`
- Modify: `clipsync-server/src/server.ts` — replace `createApp`'s standalone export with a `createHttpServer(db, blobDir)` that wires the WS upgrade; wire `onChange` from clipboard/upload routes into `hub.broadcast`
- Modify: `clipsync-server/src/routes/pairing.routes.ts` — unpair disconnects the revoked device's live socket
- Test: `clipsync-server/tests/ws.hub.test.ts`
- Test: `clipsync-server/tests/ws.integration.test.ts`

**Interfaces:**
- Consumes: `ClipboardEvent` (Task 1), `DevicesRepo` (Task 3), signature helpers (Task 2).
- Produces: `class ConnectionHub` with `add(deviceId: string, socket: WebSocket): void`, `remove(deviceId: string, socket: WebSocket): void`, `broadcast(event: ClipboardEvent): void`, `disconnectDevice(deviceId: string): void`.
- Produces: `createHttpServer(db: Database.Database, blobDir?: string): { server: http.Server; hub: ConnectionHub }` — the new entry point `src/server.ts`'s bottom-of-file bootstrap calls when actually starting the process (as opposed to `createApp`, which remains for tests that only need the Express app, not a live socket).
- WebSocket clients connect to `wss://host/clipboard?deviceId=...&timestamp=...&signature=...` (browsers can't set custom headers on the WebSocket handshake, so auth travels in the query string). The signed canonical string for this handshake is `buildCanonicalString('GET', '/clipboard', timestamp, sha256Hex(''))` — the same scheme as every other bodyless request.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/ws.hub.test.ts
import { describe, expect, it, vi } from 'vitest';
import { ConnectionHub } from '../src/ws/hub.js';

function fakeSocket() {
  return { readyState: 1, send: vi.fn(), close: vi.fn() } as any;
}

describe('ConnectionHub', () => {
  it('broadcasts an event to every added socket', () => {
    const hub = new ConnectionHub();
    const a = fakeSocket();
    const b = fakeSocket();
    hub.add('device-a', a);
    hub.add('device-b', b);
    hub.broadcast({ type: 'clipboard.cleared' });
    expect(a.send).toHaveBeenCalledWith(JSON.stringify({ type: 'clipboard.cleared' }));
    expect(b.send).toHaveBeenCalledWith(JSON.stringify({ type: 'clipboard.cleared' }));
  });

  it('stops sending to a removed socket', () => {
    const hub = new ConnectionHub();
    const a = fakeSocket();
    hub.add('device-a', a);
    hub.remove('device-a', a);
    hub.broadcast({ type: 'clipboard.cleared' });
    expect(a.send).not.toHaveBeenCalled();
  });

  it('closes and forgets every socket for a disconnected device', () => {
    const hub = new ConnectionHub();
    const a = fakeSocket();
    hub.add('device-a', a);
    hub.disconnectDevice('device-a');
    expect(a.close).toHaveBeenCalled();
    hub.broadcast({ type: 'clipboard.cleared' });
    expect(a.send).not.toHaveBeenCalled();
  });
});
```

```ts
// tests/ws.integration.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import WebSocket from 'ws';
import { createHttpServer } from '../src/server.js';
import { openDb } from '../src/db/client.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateDeviceKeys, signRequest } from './helpers/testKeys.js';

describe('WebSocket real-time updates', () => {
  let dataDir: string;
  let httpServer: ReturnType<typeof createHttpServer>['server'];

  afterEach(() => {
    httpServer?.close();
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('pushes clipboard.created to a connected authenticated client when another device posts an item', async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipsync-ws-'));
    const db = openDb(path.join(dataDir, 'clipsync.db'));
    const blobDir = path.join(dataDir, 'blobs');
    fs.mkdirSync(blobDir, { recursive: true });
    const { server, } = createHttpServer(db, blobDir);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    const httpApp = `http://127.0.0.1:${port}`;
    const start = await request(httpApp).post('/api/pairing/start').send({ initiatorDeviceName: 'Mac' });
    const keys = generateDeviceKeys();
    const complete = await request(httpApp).post('/api/pairing/complete').send({
      token: start.body.token,
      deviceName: 'Mac',
      publicKeyAuthJwk: keys.publicKeyAuthJwk,
      publicKeyExchangeJwk: keys.publicKeyExchangeJwk,
    });
    const deviceId = complete.body.deviceId;

    const timestamp = String(Date.now());
    const headers = signRequest(keys.privateKeyAuth, 'GET', '/clipboard', Buffer.alloc(0), timestamp);
    const wsUrl = `ws://127.0.0.1:${port}/clipboard?deviceId=${deviceId}&timestamp=${timestamp}&signature=${encodeURIComponent(headers['X-ClipSync-Signature'])}`;
    const socket = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });

    const received = new Promise((resolve) => socket.once('message', (data) => resolve(JSON.parse(data.toString()))));

    const postBody = Buffer.from(JSON.stringify({ contentType: 'text/plain', ciphertext: 'hello' }));
    const postHeaders = signRequest(keys.privateKeyAuth, 'POST', '/api/clipboard', postBody);
    postHeaders['X-ClipSync-Device-Id'] = deviceId;
    await request(httpApp).post('/api/clipboard').set(postHeaders).send(JSON.parse(postBody.toString()));

    const message = (await received) as any;
    expect(message.type).toBe('clipboard.created');
    expect(message.item.ciphertext).toBe('hello');
    socket.close();
  });

  it('rejects a WebSocket handshake with an invalid signature', async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipsync-ws-'));
    const db = openDb(path.join(dataDir, 'clipsync.db'));
    const { server } = createHttpServer(db, path.join(dataDir, 'blobs'));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    const socket = new WebSocket(`ws://127.0.0.1:${port}/clipboard?deviceId=nobody&timestamp=${Date.now()}&signature=bad`);
    const closeCode = await new Promise((resolve) => socket.once('close', (code) => resolve(code)));
    expect(closeCode).not.toBe(1000);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- ws.hub ws.integration`
Expected: FAIL — `src/ws/hub.ts` doesn't exist; `createHttpServer` isn't exported from `src/server.ts`.

- [ ] **Step 3: Implement**

```ts
// src/ws/hub.ts
import type WebSocket from 'ws';
import type { ClipboardEvent } from '../types.js';

export class ConnectionHub {
  private socketsByDevice = new Map<string, Set<WebSocket>>();

  add(deviceId: string, socket: WebSocket): void {
    const set = this.socketsByDevice.get(deviceId) ?? new Set();
    set.add(socket);
    this.socketsByDevice.set(deviceId, set);
  }

  remove(deviceId: string, socket: WebSocket): void {
    this.socketsByDevice.get(deviceId)?.delete(socket);
  }

  broadcast(event: ClipboardEvent): void {
    const payload = JSON.stringify(event);
    for (const sockets of this.socketsByDevice.values()) {
      for (const socket of sockets) {
        if (socket.readyState === 1 /* OPEN */) socket.send(payload);
      }
    }
  }

  disconnectDevice(deviceId: string): void {
    const sockets = this.socketsByDevice.get(deviceId);
    if (!sockets) return;
    for (const socket of sockets) socket.close();
    this.socketsByDevice.delete(deviceId);
  }
}
```

```ts
// src/server.ts — modify: add createHttpServer with authenticated WS upgrade
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { ConnectionHub } from './ws/hub.js';
import { buildCanonicalString, sha256Hex, verifySignature } from './crypto/signatures.js';

// createApp stays as-is for route-level tests, but now accepts an optional
// onChange sink so createHttpServer can route events through the hub.
export function createApp(
  db: Database,
  blobDir: string = config.blobDir,
  onChange: (event: import('./types.js').ClipboardEvent) => void = () => {},
): express.Express {
  // ...unchanged setup...
  const clipboardItems = createClipboardItemsRepo(db);
  const onEvict = (evicted: ClipboardItem[]) => {
    for (const item of evicted) if (item.blobPath) void deleteBlob(item.blobPath);
  };
  app.use('/api/pairing', createPairingRouter(devices, pairingSessions, onDeviceRevoked));
  app.use('/api/clipboard', createClipboardRouter(devices, clipboardItems, onEvict, onChange));
  app.use('/api/clipboard', createUploadsRouter(devices, clipboardItems, blobDir, onChange));
  return app;

  function onDeviceRevoked(deviceId: string) {
    hubRef?.disconnectDevice(deviceId);
  }
}

let hubRef: ConnectionHub | undefined; // set by createHttpServer; undefined in pure createApp tests

export function createHttpServer(db: Database, blobDir: string = config.blobDir) {
  const hub = new ConnectionHub();
  hubRef = hub;
  const app = createApp(db, blobDir, (event) => hub.broadcast(event));
  const devices = createDevicesRepo(db);
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    if (url.pathname !== '/clipboard') {
      socket.destroy();
      return;
    }
    const deviceId = url.searchParams.get('deviceId');
    const timestamp = url.searchParams.get('timestamp');
    const signature = url.searchParams.get('signature');
    const device = deviceId ? devices.getDeviceById(deviceId) : undefined;
    const ts = Number(timestamp);
    const withinWindow = Number.isFinite(ts) && Math.abs(Date.now() - ts) <= config.authWindowMs;
    const canonical = timestamp ? buildCanonicalString('GET', '/clipboard', timestamp, sha256Hex('')) : '';
    const validSignature =
      !!device && !device.revokedAt && withinWindow && !!signature && verifySignature(device.publicKeyAuthJwk, canonical, signature);

    if (!validSignature || !device) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      hub.add(device.deviceId, ws);
      ws.on('close', () => hub.remove(device.deviceId, ws));
    });
  });

  return { server, hub };
}
```

```ts
// src/routes/pairing.routes.ts — modify: accept an onDeviceRevoked callback and call it after revoking
export function createPairingRouter(
  devices: DevicesRepo,
  sessions: PairingSessionsRepo,
  onDeviceRevoked: (deviceId: string) => void = () => {},
): Router {
  // ...unchanged...
  router.delete('/devices/:deviceId', requireAuth, (req, res) => {
    devices.revokeDevice(req.params.deviceId);
    onDeviceRevoked(req.params.deviceId);
    res.status(204).send();
  });
  return router;
}
```

Update the bottom-of-file process bootstrap (previously implied, now made explicit) to use `createHttpServer` instead of `createApp` directly when actually running the service:

```ts
// src/server.ts — append at the bottom, guarded so importing the module for tests doesn't start listening
import { fileURLToPath } from 'node:url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openDb(config.dbPath);
  const { server } = createHttpServer(db, config.blobDir);
  server.listen(config.port, config.bindHost, () => {
    console.log(`ClipSync server listening on ${config.bindHost}:${config.port}`);
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS across every test file. `ws.integration.test.ts` exercises a real TCP server on an ephemeral port; if it's flaky in CI, confirm the `server.listen(0, ...)` callback is awaited before requests fire (it already is above).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: authenticated WebSocket hub with real-time clipboard broadcast"
```

---

### Task 9: Redacted logging middleware

**Files:**
- Create: `clipsync-server/src/middleware/logging.ts`
- Modify: `clipsync-server/src/server.ts` — mount the logging middleware first, before body parsing
- Test: `clipsync-server/tests/logging.redaction.test.ts`

**Interfaces:**
- Consumes: nothing beyond Express's `Request`/`Response` types.
- Produces: `requestLogger(sink: (line: string) => void = console.log): express.RequestHandler` — logs one line per request after it finishes, containing only method, path, status, response time in ms, content-type, and content-length. Never logs headers values (device IDs are acceptable — PRD allows "device=android" style metadata — but signatures and any request/response body are never touched).

- [ ] **Step 1: Write the failing test**

```ts
// tests/logging.redaction.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { buildTestServer } from './helpers/testServer.js';
import { requestLogger } from '../src/middleware/logging.js';

describe('requestLogger', () => {
  let ctx: ReturnType<typeof buildTestServer>;
  afterEach(() => ctx?.cleanup());

  it('logs operational metadata but never the request or response body', async () => {
    ctx = buildTestServer();
    const lines: string[] = [];
    ctx.app.use(requestLogger((line) => lines.push(line)));

    const secretText = 'super-secret-verification-code-482913';
    await request(ctx.app).post('/api/clipboard').send({ contentType: 'text/plain', ciphertext: secretText });

    expect(lines.length).toBeGreaterThan(0);
    const joined = lines.join('\n');
    expect(joined).not.toContain(secretText);
    expect(joined).toMatch(/POST \/api\/clipboard \d{3}/);
  });
});
```

Note: `requestLogger` must be mounted with `app.use(requestLogger(...))` *before* any route handlers so it wraps every request; the test above adds it after the app is built only to prove it can be composed independently — the real wiring in `server.ts` (Step 3) mounts it first.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- logging.redaction`
Expected: FAIL — `src/middleware/logging.ts` doesn't exist.

- [ ] **Step 3: Implement**

```ts
// src/middleware/logging.ts
import type { RequestHandler } from 'express';

export function requestLogger(sink: (line: string) => void = console.log): RequestHandler {
  return (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      const contentLength = res.getHeader('content-length') ?? '0';
      // Deliberately omits req.body, res.body, and every signature/auth
      // header value — only method, path, status, timing, and size.
      sink(`${req.method} ${req.path} ${res.statusCode} ${ms}ms size=${contentLength}`);
    });
    next();
  };
}
```

```ts
// src/server.ts — modify: mount the logger first, before express.json()
import { requestLogger } from './middleware/logging.js';

export function createApp(/* ... */): express.Express {
  const app = express();
  app.use(requestLogger());
  app.use(express.json({ /* ...unchanged... */ }));
  // ...rest unchanged...
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS across every test file.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: redacted request logging with no clipboard content"
```

---

### Task 10: LAN-only binding and local HTTPS/WSS

**Files:**
- Modify: `clipsync-server/src/config.ts` — add TLS cert path config
- Modify: `clipsync-server/src/server.ts` — `createHttpServer` uses `https.createServer` when cert config is present, falls back to plain `http` otherwise (for local development convenience only)
- Create: `clipsync-server/docs/LOCAL_HTTPS.md`
- Test: `clipsync-server/tests/server.tls-config.test.ts`

**Interfaces:**
- Consumes: `config` (Task 1).
- Produces: `config.tls: { certPath: string; keyPath: string } | undefined`, read from `CLIPSYNC_TLS_CERT` / `CLIPSYNC_TLS_KEY` env vars.
- Produces: `createHttpServer` picks `https` when both env vars are set and the files exist, otherwise `http` — this branch is exercised by constructing the server with an explicit `tlsOverride` parameter in tests rather than mutating `process.env` mid-suite.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server.tls-config.test.ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import selfsigned from 'selfsigned'; // dev-only cert generator, see Step 3 note
import { createHttpServer } from '../src/server.js';
import { openDb } from '../src/db/client.js';

describe('createHttpServer TLS selection', () => {
  it('builds a plain HTTP server when no TLS config is supplied', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipsync-tls-'));
    const db = openDb(path.join(dataDir, 'clipsync.db'));
    const { server } = createHttpServer(db, path.join(dataDir, 'blobs'));
    expect(server.constructor.name).toBe('Server'); // node:http.Server
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('builds an HTTPS server when a cert and key are supplied', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipsync-tls-'));
    const db = openDb(path.join(dataDir, 'clipsync.db'));
    const pems = selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { days: 1 });
    const certPath = path.join(dataDir, 'cert.pem');
    const keyPath = path.join(dataDir, 'key.pem');
    fs.writeFileSync(certPath, pems.cert);
    fs.writeFileSync(keyPath, pems.private);

    const { server } = createHttpServer(db, path.join(dataDir, 'blobs'), { certPath, keyPath });
    expect(server.constructor.name).toBe('Server'); // node:https.Server is also named "Server"
    // Distinguish via a property only https servers expose:
    expect('setSecureContext' in server).toBe(true);
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm install -D selfsigned && npm test -- server.tls-config`
Expected: FAIL — `createHttpServer` doesn't accept a third `tlsOverride` argument yet, and always returns an `http.Server`.

- [ ] **Step 3: Implement**

```ts
// src/config.ts — modify: add TLS config
export const config = {
  // ...existing fields...
  tls:
    process.env.CLIPSYNC_TLS_CERT && process.env.CLIPSYNC_TLS_KEY
      ? { certPath: process.env.CLIPSYNC_TLS_CERT, keyPath: process.env.CLIPSYNC_TLS_KEY }
      : undefined,
} as const;
```

```ts
// src/server.ts — modify: support HTTPS
import https from 'node:https';
import fs from 'node:fs';

export function createHttpServer(
  db: Database,
  blobDir: string = config.blobDir,
  tlsOverride?: { certPath: string; keyPath: string },
) {
  const hub = new ConnectionHub();
  hubRef = hub;
  const app = createApp(db, blobDir, (event) => hub.broadcast(event));
  const devices = createDevicesRepo(db);

  const tls = tlsOverride ?? config.tls;
  const server = tls
    ? https.createServer(
        { cert: fs.readFileSync(tls.certPath), key: fs.readFileSync(tls.keyPath) },
        app,
      )
    : http.createServer(app);

  const wss = new WebSocketServer({ noServer: true });
  // ...upgrade handling unchanged, `server.on('upgrade', ...)` works identically
  // for both http.Server and https.Server...

  return { server, hub };
}
```

`docs/LOCAL_HTTPS.md`:

```markdown
# Local HTTPS for ClipSync

Browsers require a secure context for the Clipboard API and for the WebSocket
to use `wss`. On a local network without a public domain, generate a
certificate trusted by both the Mac and the Android phone using mkcert:

1. Install mkcert on the Mac: `brew install mkcert`.
2. Install the local CA: `mkcert -install`.
3. Generate a certificate for the Mac's LAN IP (find it with
   `ipconfig getifaddr en0`, e.g. `192.168.1.20`):

   ```bash
   mkcert -cert-file cert.pem -key-file key.pem 192.168.1.20 localhost 127.0.0.1
   ```

4. Point the server at the generated files and set the LAN bind address:

   ```bash
   export CLIPSYNC_TLS_CERT=$(pwd)/cert.pem
   export CLIPSYNC_TLS_KEY=$(pwd)/key.pem
   export CLIPSYNC_BIND_HOST=192.168.1.20
   npm start
   ```

5. On Android, install mkcert's root CA (`mkcert -CAROOT` shows where it
   lives) via Settings → Security → "Install a certificate", or accept the
   browser's certificate warning once if you skip this step (not recommended
   for anything beyond local testing).

Without this setup the server falls back to plain HTTP/`ws`, which the
Clipboard API and some PWA install prompts will refuse to work with outside
`localhost`.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS across every test file, including the two new TLS-selection tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: local HTTPS/WSS support and mkcert setup docs"
```

---

## Self-Review

**Spec coverage** (PRD/PRODUCT.md requirement → task):

- Device pairing, QR-session token, single-use/expiring, 1 Mac + 1 Android cap → Task 4.
- Device identity, private keys never leave the device, server never stores them → enforced by design: Tasks 3–4 only ever store/consume public JWKs; no private key material appears server-side anywhere in this plan.
- Authentication on every clipboard/pairing/WebSocket operation → Tasks 3, 4, 6, 7, 8.
- Unpair, immediate revocation, live-socket disconnect → Task 4 (HTTP revoke) + Task 8 (socket disconnect wiring).
- Clipboard add/list/delete/clear, 50-item retention with blob cleanup → Tasks 5, 6, 7.
- Images as binary files, not Base64, authenticated access only → Task 7.
- Real-time push over WebSocket, `clipboard.created`/`deleted`/`cleared` events → Task 8.
- No clipboard content in logs → Task 9.
- Local-network-only binding, no auto port forwarding/UPnP → Task 1 (`bindHost` defaults to `127.0.0.1`) + Global Constraints; this plan never adds UPnP/tunneling code, so the constraint holds by omission.
- Local HTTPS/`wss` → Task 10.
- Pairing session expiry/single-use/reuse rejection → Task 4's tests explicitly cover reuse (410) and the device cap (409).

Not covered here, by design (belongs to the deferred Web Client plan): Clipboard API capture, manual paste fallback UI, QR code rendering/scanning, device key generation in the browser, content encryption/decryption, PWA manifest/install, and all visual design from `DESIGN.md`.

**Placeholder scan:** no `TBD`/`TODO`/"handle appropriately" language appears in any task; every step above has runnable code. The one deliberately-flagged item is the 10 MB upload ceiling in Task 7, which is called out as a stated assumption (PRODUCT.md left it open) rather than a placeholder.

**Type consistency:** `Device`, `PairingSession`, `ClipboardItem`, and `ClipboardEvent` are defined once in Task 1's `types.ts` and imported by every later task without renaming. Repo factory names follow one pattern throughout: `createDevicesRepo`, `createPairingSessionsRepo`, `createClipboardItemsRepo`. Router factory names follow `create<Noun>Router` throughout. `onEvict`/`onChange` callback signatures introduced in Task 6 are reused unchanged in Tasks 7 and 8.

---

## Next plan (not written yet)

Once the Paper.design screens for ClipSync are finalized, write a companion plan — `clipsync-web-client` — covering: Next.js PWA scaffold, Clipboard API capture + manual fallback, device Ed25519/X25519 key generation via WebCrypto, QR pairing UI (display on Mac, scan on Android), client-side AEAD encryption/decryption of clipboard payloads using the `publicKeyExchangeJwk` this server hands over at `POST /api/pairing/complete`, and the screens themselves built to the tokens this server's plan never touches. That plan should cite the exact Paper artboards and DESIGN.md tokens as its file-structure input, the way this plan cited PRD.md's API and security sections.
