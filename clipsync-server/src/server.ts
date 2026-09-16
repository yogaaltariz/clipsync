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
  // routes (pairing in Task 4, clipboard in Task 6, and the upload
  // download route in Task 7) are wired to this same middleware instance.
  // The upload route's own POST handler (Task 7) performs its own inline
  // signature check instead, since its body arrives as multipart/form-data
  // rather than JSON — this raw-body capture only fires for JSON bodies.
  app.get('/__test/protected', deviceAuth(devices), (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.post('/__test/protected', deviceAuth(devices), (_req, res) => {
    res.status(200).json({ ok: true });
  });

  return app;
}
