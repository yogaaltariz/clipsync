import type { Database } from 'better-sqlite3';
import type { Device } from '../types.js';

export interface DevicesRepo {
  insertDevice(device: Device): void;
  getDeviceById(deviceId: string): Device | undefined;
  listActiveDevices(): Device[];
  countActiveDevices(): number;
  revokeDevice(deviceId: string): void;
}

function rowToDevice(row: any): Device {
  return {
    deviceId: row.device_id,
    deviceName: row.device_name,
    publicKeyAuthJwk: row.public_key_auth_jwk,
    publicKeyExchangeJwk: row.public_key_exchange_jwk,
    pairedAt: row.paired_at,
    revokedAt: row.revoked_at,
  };
}

export function createDevicesRepo(db: Database): DevicesRepo {
  return {
    insertDevice(device) {
      db.prepare(
        `INSERT INTO devices (device_id, device_name, public_key_auth_jwk, public_key_exchange_jwk, paired_at, revoked_at)
         VALUES (@deviceId, @deviceName, @publicKeyAuthJwk, @publicKeyExchangeJwk, @pairedAt, @revokedAt)`,
      ).run(device);
    },
    getDeviceById(deviceId) {
      const row = db.prepare('SELECT * FROM devices WHERE device_id = ?').get(deviceId);
      return row ? rowToDevice(row) : undefined;
    },
    listActiveDevices() {
      return db
        .prepare('SELECT * FROM devices WHERE revoked_at IS NULL')
        .all()
        .map(rowToDevice);
    },
    countActiveDevices() {
      const row = db
        .prepare('SELECT COUNT(*) AS n FROM devices WHERE revoked_at IS NULL')
        .get() as { n: number };
      return row.n;
    },
    revokeDevice(deviceId) {
      db.prepare('UPDATE devices SET revoked_at = ? WHERE device_id = ?').run(
        new Date().toISOString(),
        deviceId,
      );
    },
  };
}
