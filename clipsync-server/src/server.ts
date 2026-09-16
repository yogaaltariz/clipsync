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
