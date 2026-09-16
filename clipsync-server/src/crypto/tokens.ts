import { randomBytes } from 'node:crypto';

export function generatePairingToken(): string {
  return randomBytes(32).toString('base64url');
}
