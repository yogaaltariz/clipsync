import { randomUUID, createPublicKey } from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { generatePairingToken } from '../crypto/tokens.js';
import { deviceAuth } from '../middleware/deviceAuth.js';
import type { DevicesRepo } from '../db/devices.repo.js';
import type { PairingSessionsRepo } from '../db/pairingSessions.repo.js';

function isValidJwkOfType(jwkString: string, expectedType: string): boolean {
  try {
    const key = createPublicKey({ key: JSON.parse(jwkString), format: 'jwk' });
    return key.asymmetricKeyType === expectedType;
  } catch {
    return false;
  }
}

export function createPairingRouter(
  devices: DevicesRepo,
  sessions: PairingSessionsRepo,
  onDeviceRevoked: (deviceId: string) => void = () => {},
): Router {
  const router = Router();
  const requireAuth = deviceAuth(devices);

  router.post('/start', (req, res, next) => {
    // Bootstrap case: the very first device pairs without prior auth.
    const hasAnyAuthHeaders =
      req.header('X-ClipSync-Device-Id') ||
      req.header('X-ClipSync-Timestamp') ||
      req.header('X-ClipSync-Signature');
    if (devices.countActiveDevices() === 0 && !hasAnyAuthHeaders) {
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
    const { initiatorDeviceName } = (req.body ?? {}) as { initiatorDeviceName?: string };
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
    const { token, deviceName, publicKeyAuthJwk, publicKeyExchangeJwk } = (req.body ?? {}) as {
      token?: string;
      deviceName?: string;
      publicKeyAuthJwk?: string;
      publicKeyExchangeJwk?: string;
    };
    if (!token || !deviceName || !publicKeyAuthJwk || !publicKeyExchangeJwk) {
      res.status(400).json({ error: 'missing fields' });
      return;
    }
    if (!isValidJwkOfType(publicKeyAuthJwk, 'ed25519') || !isValidJwkOfType(publicKeyExchangeJwk, 'x25519')) {
      res.status(400).json({ error: 'invalid_public_key' });
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

  router.get('/devices', requireAuth, (req, res) => {
    const self = (req as any).device;
    const peerDevices = devices.listActiveDevices().filter((d) => d.deviceId !== self.deviceId);
    res.status(200).json({ peerDevices });
  });

  router.delete('/devices/:deviceId', requireAuth, (req, res) => {
    // req.params values are typed string | string[] by the installed
    // @types/express-serve-static-core (permissive default for repeated-
    // capture routes like :id*, which this project doesn't use) — this
    // route's :deviceId segment is always a single string at runtime.
    const deviceId = req.params.deviceId as string;
    devices.revokeDevice(deviceId);
    onDeviceRevoked(deviceId);
    res.status(204).send();
  });

  return router;
}
