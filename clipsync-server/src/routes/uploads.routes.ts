import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { buildCanonicalString, sha256Hex, verifySignature } from '../crypto/signatures.js';
import { blobPathFor, deleteBlob, readBlob, writeBlob } from '../storage/blobStore.js';
import type { DevicesRepo } from '../db/devices.repo.js';
import type { ClipboardItemsRepo } from '../db/clipboardItems.repo.js';
import type { ClipboardEvent, ClipboardItem } from '../types.js';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB — MVP fixed ceiling, see Interfaces note.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

export function createUploadsRouter(
  devices: DevicesRepo,
  items: ClipboardItemsRepo,
  blobDir: string,
  onChange: (event: ClipboardEvent) => void = () => {},
): Router {
  const router = Router();

  router.post('/:id/blob', (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({ error: 'file_too_large' });
          return;
        }
        next(err);
        return;
      }
      next();
    });
  }, async (req, res) => {
    const deviceId = req.header('X-ClipSync-Device-Id');
    const timestamp = req.header('X-ClipSync-Timestamp');
    const signature = req.header('X-ClipSync-Signature');
    const file = (req as any).file as { buffer: Buffer } | undefined;

    if (!deviceId || !timestamp || !signature || !file) {
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
    const canonical = buildCanonicalString(req.method, req.originalUrl, timestamp, sha256Hex(file.buffer));
    if (!verifySignature(device.publicKeyAuthJwk, canonical, signature)) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }

    // req.params values are typed string | string[] by the installed
    // @types/express-serve-static-core (permissive default for repeated-
    // capture routes like :id*, which this project doesn't use) — this
    // route's :id segment is always a single string at runtime.
    const id = req.params.id as string;
    const item = items.listItems(1_000_000).find((i) => i.id === id);
    if (!item) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const relativeBlobPath = await writeBlob(blobDir, item.id, file.buffer);
    const updated: ClipboardItem = { ...item, blobPath: relativeBlobPath, ciphertext: null };
    items.deleteItem(item.id);
    items.insertItem(updated);
    onChange({ type: 'clipboard.created', item: updated });
    res.status(200).json(updated);
  });

  router.get('/:id/blob', (req, res, next) => {
    const deviceAuthCheck = () => {
      const deviceId = req.header('X-ClipSync-Device-Id');
      const timestamp = req.header('X-ClipSync-Timestamp');
      const signature = req.header('X-ClipSync-Signature');
      if (!deviceId || !timestamp || !signature) return false;
      const ts = Number(timestamp);
      if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > config.authWindowMs) return false;
      const device = devices.getDeviceById(deviceId);
      if (!device || device.revokedAt) return false;
      const canonical = buildCanonicalString(req.method, req.originalUrl, timestamp, sha256Hex(''));
      return verifySignature(device.publicKeyAuthJwk, canonical, signature);
    };
    if (!deviceAuthCheck()) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    next();
  }, async (req, res) => {
    // req.params values are typed string | string[] by the installed
    // @types/express-serve-static-core (permissive default for repeated-
    // capture routes like :id*, which this project doesn't use) — this
    // route's :id segment is always a single string at runtime.
    const id = req.params.id as string;
    const item = items.listItems(1_000_000).find((i) => i.id === id);
    if (!item || !item.blobPath) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const absolutePath = path.join(blobDir, item.blobPath);
    const data = await readBlob(absolutePath);
    res.status(200).type(item.contentType).send(data);
  });

  return router;
}
