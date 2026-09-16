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
