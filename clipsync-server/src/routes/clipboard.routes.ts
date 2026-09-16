import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { deviceAuth } from '../middleware/deviceAuth.js';
import type { DevicesRepo } from '../db/devices.repo.js';
import type { ClipboardItemsRepo } from '../db/clipboardItems.repo.js';
import type { ClipboardEvent, ClipboardItem } from '../types.js';

export function createClipboardRouter(
  devices: DevicesRepo,
  items: ClipboardItemsRepo,
  onEvict: (evicted: ClipboardItem[]) => void = () => {},
  onChange: (event: ClipboardEvent) => void = () => {},
): Router {
  const router = Router();
  const requireAuth = deviceAuth(devices);

  router.post('/', requireAuth, (req, res) => {
    const { contentType, ciphertext } = req.body as { contentType?: string; ciphertext?: string };
    if (!contentType || !ciphertext) {
      res.status(400).json({ error: 'contentType and ciphertext required' });
      return;
    }
    const device = (req as any).device;
    const item: ClipboardItem = {
      id: randomUUID(),
      contentType,
      ciphertext,
      blobPath: null,
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      createdAt: new Date().toISOString(),
    };
    items.insertItem(item);
    onChange({ type: 'clipboard.created', item });

    const evicted = items.evictOverLimit(config.historyLimit);
    if (evicted.length > 0) onEvict(evicted);

    res.status(201).json(item);
  });

  router.get('/', requireAuth, (_req, res) => {
    res.status(200).json({ items: items.listItems(config.historyLimit) });
  });

  router.delete('/:id', requireAuth, (req, res) => {
    // req.params values are typed string | string[] by the installed
    // @types/express-serve-static-core (permissive default for repeated-
    // capture routes like :id*, which this project doesn't use) — this
    // route's :id segment is always a single string at runtime.
    const id = req.params.id as string;
    const deleted = items.deleteItem(id);
    if (!deleted) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    onChange({ type: 'clipboard.deleted', id: deleted.id });
    if (deleted.blobPath) onEvict([deleted]);
    res.status(204).send();
  });

  router.delete('/', requireAuth, (_req, res) => {
    const cleared = items.clearAll();
    onChange({ type: 'clipboard.cleared' });
    const withBlobs = cleared.filter((i) => i.blobPath);
    if (withBlobs.length > 0) onEvict(withBlobs);
    res.status(204).send();
  });

  return router;
}
