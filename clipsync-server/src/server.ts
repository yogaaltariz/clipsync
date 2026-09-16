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
