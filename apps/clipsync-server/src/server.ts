import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import express from 'express';
import type { Database } from 'better-sqlite3';
import { WebSocketServer } from 'ws';
import { createDevicesRepo } from './db/devices.repo.js';
import { createPairingSessionsRepo } from './db/pairingSessions.repo.js';
import { createPairingRouter } from './routes/pairing.routes.js';
import { createClipboardItemsRepo } from './db/clipboardItems.repo.js';
import { createClipboardRouter } from './routes/clipboard.routes.js';
import { createUploadsRouter } from './routes/uploads.routes.js';
import { deleteBlob } from './storage/blobStore.js';
import { config } from './config.js';
import { ConnectionHub } from './ws/hub.js';
import { buildCanonicalString, sha256Hex, verifySignature } from './crypto/signatures.js';
import { requestLogger, errorLogger } from './middleware/logging.js';

let hubRef: ConnectionHub | undefined; // set by createHttpServer; undefined in pure createApp tests

export function createApp(
  db: Database,
  blobDir: string = config.blobDir,
  onChange: (event: import('./types.js').ClipboardEvent) => void = () => {},
): express.Express {
  const app = express();

  app.use(requestLogger());

  app.use(
    express.json({
      limit: config.maxJsonBodyBytes,
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

  function onDeviceRevoked(deviceId: string) {
    hubRef?.disconnectDevice(deviceId);
  }

  app.use('/api/pairing', createPairingRouter(devices, pairingSessions, onDeviceRevoked));

  const clipboardItems = createClipboardItemsRepo(db);
  const onEvict = (evicted: import('./types.js').ClipboardItem[]) => {
    for (const item of evicted) {
      if (item.blobPath) {
        deleteBlob(path.join(blobDir, item.blobPath)).catch((err) => {
          console.log(`blob delete failed error=${err?.constructor?.name ?? 'Error'}`);
        });
      }
    }
  };
  app.use('/api/clipboard', createClipboardRouter(devices, clipboardItems, onEvict, onChange));
  app.use('/api/clipboard', createUploadsRouter(devices, clipboardItems, blobDir, onChange));

  app.use(errorLogger());

  return app;
}

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

  server.on('upgrade', (req, socket, head) => {
    try {
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
        ws.on('error', () => hub.remove(device.deviceId, ws));
      });
    } catch {
      socket.destroy();
    }
  });

  return { server, hub };
}

import { fileURLToPath } from 'node:url';
import { openDb } from './db/client.js';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openDb(config.dbPath);
  const { server } = createHttpServer(db, config.blobDir);

  if (!config.tls && config.bindHost !== '127.0.0.1' && config.bindHost !== '::1' && config.bindHost !== 'localhost') {
    console.log(`WARNING: binding to ${config.bindHost} without TLS configured — traffic on the LAN is unencrypted. Set CLIPSYNC_TLS_CERT and CLIPSYNC_TLS_KEY (see docs/LOCAL_HTTPS.md), or restrict CLIPSYNC_BIND_HOST to 127.0.0.1.`);
  }
  if ((process.env.CLIPSYNC_TLS_CERT && !process.env.CLIPSYNC_TLS_KEY) || (!process.env.CLIPSYNC_TLS_CERT && process.env.CLIPSYNC_TLS_KEY)) {
    console.log('WARNING: only one of CLIPSYNC_TLS_CERT/CLIPSYNC_TLS_KEY is set — falling back to plain HTTP. Both must be set to enable TLS.');
  }

  server.listen(config.port, config.bindHost, () => {
    console.log(`ClipSync server listening on ${config.bindHost}:${config.port}`);
  });
}
