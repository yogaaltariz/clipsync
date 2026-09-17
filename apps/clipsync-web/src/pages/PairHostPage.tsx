import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import QRCode from 'qrcode';
import { useAppState } from '../lib/appState.js';
import { encodePairingPayload } from '../lib/pairingQr.js';
import { LaptopIcon, LockIcon } from '../components/icons.js';
import './PairShell.css';

export function PairHostPage() {
  const { peerDevices, startInvitingNewDevice, refreshPeerDevices } = useAppState();
  const navigate = useNavigate();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const regenerateTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const generateCode = useCallback(async () => {
    try {
      const { token, expiresAt } = await startInvitingNewDevice();
      const dataUrl = await QRCode.toDataURL(encodePairingPayload({ v: 1, token }), {
        margin: 1,
        width: 344,
        color: { dark: '#181925', light: '#FFFFFF' },
      });
      setQrDataUrl(dataUrl);
      setError(null);
      const msUntilExpiry = new Date(expiresAt).getTime() - Date.now();
      regenerateTimerRef.current = setTimeout(generateCode, Math.max(5000, msUntilExpiry));
    } catch {
      setError('Could not start pairing. Check the server is reachable and try again.');
    }
  }, [startInvitingNewDevice]);

  useEffect(() => {
    generateCode();
    return () => clearTimeout(regenerateTimerRef.current);
  }, [generateCode]);

  useEffect(() => {
    if (peerDevices.length > 0) {
      navigate('/pair/success', { replace: true });
      return;
    }
    const interval = setInterval(() => refreshPeerDevices(), 2000);
    return () => clearInterval(interval);
  }, [peerDevices, refreshPeerDevices, navigate]);

  return (
    <div className="pair-shell">
      <span className="pair-shell__icon">
        <LaptopIcon size={28} />
      </span>
      <div>
        <div className="pair-shell__title">Pair your phone</div>
        <p className="pair-shell__body">
          On your phone's browser, go to <strong>{window.location.origin}</strong>, then scan the code below.
        </p>
      </div>
      <div className="pair-shell__server-url">{window.location.origin}</div>
      <div className="pair-shell__qr-frame">
        {qrDataUrl && <img src={qrDataUrl} alt="Pairing QR code" />}
      </div>
      {error && <p className="pair-shell__error">{error}</p>}
      <div className="pair-shell__hint">
        <LockIcon />
        <span>Your phone and this device exchange a private key over Wi-Fi. The pairing code expires in minutes and can't be reused.</span>
      </div>
    </div>
  );
}
