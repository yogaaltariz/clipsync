import type { Database } from 'better-sqlite3';
import type { PairingSession } from '../types.js';

export interface PairingSessionsRepo {
  createSession(session: PairingSession): void;
  getSession(token: string): PairingSession | undefined;
  markUsed(token: string): void;
}

function rowToSession(row: any): PairingSession {
  return {
    token: row.token,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    initiatorDeviceName: row.initiator_device_name,
  };
}

export function createPairingSessionsRepo(db: Database): PairingSessionsRepo {
  return {
    createSession(session) {
      db.prepare(
        `INSERT INTO pairing_sessions (token, created_at, expires_at, used_at, initiator_device_name)
         VALUES (@token, @createdAt, @expiresAt, @usedAt, @initiatorDeviceName)`,
      ).run(session);
    },
    getSession(token) {
      const row = db.prepare('SELECT * FROM pairing_sessions WHERE token = ?').get(token);
      return row ? rowToSession(row) : undefined;
    },
    markUsed(token) {
      db.prepare('UPDATE pairing_sessions SET used_at = ? WHERE token = ?').run(
        new Date().toISOString(),
        token,
      );
    },
  };
}
