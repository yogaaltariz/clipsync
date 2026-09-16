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
  const app = createApp(db, blobDir);
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
