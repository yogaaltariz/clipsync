// The QR only carries the pairing token, not the server's address: by the
// time a device reaches the scan screen it has already loaded this app from
// the host's URL (typed in manually, per the PRD pairing flow), so it's
// already talking to the right origin — see appState.tsx.
export interface PairingQrPayload {
  v: 1;
  token: string;
}

export function encodePairingPayload(payload: PairingQrPayload): string {
  return JSON.stringify(payload);
}

export function decodePairingPayload(raw: string): PairingQrPayload {
  const parsed = JSON.parse(raw) as Partial<PairingQrPayload>;
  if (parsed.v !== 1 || typeof parsed.token !== 'string') {
    throw new Error('invalid_pairing_payload');
  }
  return { v: 1, token: parsed.token };
}
