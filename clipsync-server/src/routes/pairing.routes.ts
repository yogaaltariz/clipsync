import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { generatePairingToken } from '../crypto/tokens.js';
import { deviceAuth } from '../middleware/deviceAuth.js';
import type { DevicesRepo } from '../db/devices.repo.js';
import type { PairingSessionsRepo } from '../db/pairingSessions.repo.js';

export function createPairingRouter(devices: DevicesRepo, sessions: PairingSessionsRepo): Router {
  const router = Router();
  const requireAuth = deviceAuth(devices);

  router.post('/start', (req, res, next) => {
    // Bootstrap case: the very first device pairs without prior auth.
    if (devices.countActiveDevices() === 0) {
      handleStart(req, res);
      return;
    }
    requireAuth(req, res, () => handleStart(req, res));
  });

  function handleStart(req: import('express').Request, res: import('express').Response) {
    if (devices.countActiveDevices() >= config.maxPairedDevices) {
      res.status(409).json({ error: 'max_paired_devices' });
      return;
    }
    const { initiatorDeviceName } = req.body as { initiatorDeviceName?: string };
    if (!initiatorDeviceName) {
      res.status(400).json({ error: 'initiatorDeviceName required' });
      return;
    }
    const token = generatePairingToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + config.pairingTtlMs);
    sessions.createSession({
      token,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      usedAt: null,
      initiatorDeviceName,
    });
    res.status(200).json({ token, expiresAt: expiresAt.toISOString() });
  }

  router.post('/complete', (req, res) => {
    const { token, deviceName, publicKeyAuthJwk, publicKeyExchangeJwk } = req.body as {
      token?: string;
      deviceName?: string;
      publicKeyAuthJwk?: string;
      publicKeyExchangeJwk?: string;
    };
    if (!token || !deviceName || !publicKeyAuthJwk || !publicKeyExchangeJwk) {
      res.status(400).json({ error: 'missing fields' });
      return;
    }
    const session = sessions.getSession(token);
    if (!session || session.usedAt || new Date(session.expiresAt).getTime() < Date.now()) {
      res.status(410).json({ error: 'pairing_session_invalid' });
      return;
    }
    if (devices.countActiveDevices() >= config.maxPairedDevices) {
      res.status(409).json({ error: 'max_paired_devices' });
      return;
    }

    const deviceId = randomUUID();
    devices.insertDevice({
      deviceId,
      deviceName,
      publicKeyAuthJwk,
      publicKeyExchangeJwk,
      pairedAt: new Date().toISOString(),
      revokedAt: null,
    });
    sessions.markUsed(token);

    const peerDevices = devices.listActiveDevices().filter((d) => d.deviceId !== deviceId);
    res.status(200).json({ deviceId, peerDevices });
  });

  router.delete('/devices/:deviceId', requireAuth, (req, res) => {
    devices.revokeDevice(req.params.deviceId);
    res.status(204).send();
  });

  return router;
}
