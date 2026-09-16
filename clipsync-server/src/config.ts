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
