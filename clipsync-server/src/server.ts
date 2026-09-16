import express from 'express';
import type { Database } from 'better-sqlite3';
import { createDevicesRepo } from './db/devices.repo.js';
import { createPairingSessionsRepo } from './db/pairingSessions.repo.js';
import { createPairingRouter } from './routes/pairing.routes.js';
import { createClipboardItemsRepo } from './db/clipboardItems.repo.js';
import { createClipboardRouter } from './routes/clipboard.routes.js';
import { createUploadsRouter } from './routes/uploads.routes.js';
import { deleteBlob } from './storage/blobStore.js';
import { config } from './config.js';

export function createApp(db: Database, blobDir: string = config.blobDir): express.Express {
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

  const clipboardItems = createClipboardItemsRepo(db);
  const onEvict = (evicted: import('./types.js').ClipboardItem[]) => {
    for (const item of evicted) {
      if (item.blobPath) void deleteBlob(item.blobPath);
    }
  };
  app.use('/api/clipboard', createClipboardRouter(devices, clipboardItems, onEvict));
  app.use('/api/clipboard', createUploadsRouter(devices, clipboardItems, blobDir));

  return app;
}
