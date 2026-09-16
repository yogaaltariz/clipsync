import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHttpServer } from '../src/server.js';
import { openDb } from '../src/db/client.js';

// Sends raw bytes over a fresh TCP socket to the given port and resolves once the
// socket closes (or a timeout elapses, in case the server just destroys it silently
// without writing a response). We can't use supertest/a normal HTTP client for this:
// they refuse to construct an invalid request-target, but Node's own http parser is
// lenient about the absolute-form request-target and will hand the raw string
// straight through to `req.url`/`req.originalUrl`.
function sendRawRequest(port: number, requestText: string): Promise<void> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(requestText);
    });
    socket.on('data', () => {});
    socket.on('error', () => resolve());
    socket.on('close', () => resolve());
    setTimeout(() => {
      socket.destroy();
      resolve();
    }, 500);
  });
}

describe('crash regression: malformed absolute-form request-targets must not kill the process', () => {
  let dataDir: string;
  let httpServer: ReturnType<typeof createHttpServer>['server'];
  let db: ReturnType<typeof openDb>;

  afterEach(() => {
    httpServer?.close();
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('stays alive after a malformed HTTP request-target and a malformed WebSocket upgrade request-target', async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipsync-crash-'));
    db = openDb(path.join(dataDir, 'clipsync.db'));
    const serverResult = createHttpServer(db, path.join(dataDir, 'blobs'));
    httpServer = serverResult.server;
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const port = (httpServer.address() as any).port;
    const httpApp = `http://127.0.0.1:${port}`;

    // Sanity check: the server answers normally before we throw anything malformed at it.
    const before = await request(httpApp).get('/healthz');
    expect(before.status).toBe(200);

    // 1. A raw malformed absolute-form request-target as a plain (non-upgrade) HTTP
    // request. Node's http parser accepts this at the wire level — it's the stricter
    // WHATWG URL parser used by requestLogger/errorLogger that used to throw on it —
    // so this reaches `new URL(req.originalUrl, 'http://localhost')` with
    // req.originalUrl === 'http://%'. Verified directly (outside Express) that both
    // `new URL('http://%')` and `new URL('http://%', 'http://localhost')` throw
    // `TypeError [ERR_INVALID_URL]` on this Node version — this is not a Node-version-
    // dependent maybe. (A second malformed-authority example, `http://a:b:c/`, was
    // deliberately dropped from this test: it also throws via WHATWG `new URL()`, but
    // it separately trips Express's own internal legacy `url.parse()` — used for
    // Express's route matching, unrelated to anything this fix touches — into an
    // unrelated `DEP0170` console warning. Keeping the test to `http://%` exercises
    // the exact fixed call sites without that stray noise.)
    await sendRawRequest(port, 'GET http://% HTTP/1.1\r\nHost: x\r\n\r\n');

    // 2. A raw malformed WebSocket upgrade attempt with the same malformed
    // request-target. This exercises `server.on('upgrade', ...)`'s own
    // `new URL(req.url ?? '', 'http://localhost')` call.
    await sendRawRequest(
      port,
      'GET http://% HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n',
    );

    // The server (and the whole test process) must still be alive and answering
    // normally afterwards.
    const after = await request(httpApp).get('/healthz');
    expect(after.status).toBe(200);
    expect(after.body).toEqual({ status: 'ok' });
  });
});
