import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import selfsigned from 'selfsigned'; // dev-only cert generator
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

  it('builds an HTTPS server when a cert and key are supplied', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipsync-tls-'));
    const db = openDb(path.join(dataDir, 'clipsync.db'));
    const pems = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { days: 1 });
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
