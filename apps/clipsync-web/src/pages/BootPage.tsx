import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAppState } from '../lib/appState.js';
import './PairShell.css';

// Deliberately NOT automatic: two devices loading the app around the same
// time would otherwise race to claim "device #1" over the network, and
// whichever one happened to answer first would silently become the host —
// non-deterministic, and backwards from the PRD's script where the Mac is
// always the one that shows the code. Each device is told its role by the
// person using it instead.
export function BootPage() {
  const { identityLoading, identity, peerDevices, bootstrapAsHost } = useAppState();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!identityLoading && identity) {
      navigate(peerDevices.length > 0 ? '/main' : '/pair/host', { replace: true });
    }
  }, [identityLoading, identity, peerDevices, navigate]);

  async function handleFirstDevice() {
    setBusy(true);
    setError(null);
    try {
      const result = await bootstrapAsHost();
      if (result === 'became-host') {
        navigate('/pair/host', { replace: true });
      } else {
        setError('A device is already set up on this server. Use "Join an existing pair" below, and scan the code shown on that device.');
      }
    } catch {
      setError('Could not reach the ClipSync server. Make sure it is running and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (identityLoading || identity) {
    return (
      <div className="pair-shell">
        <div className="pair-shell__spacer" />
        <p className="pair-shell__body">Loading ClipSync…</p>
        <div className="pair-shell__spacer" />
      </div>
    );
  }

  return (
    <div className="pair-shell">
      <div className="pair-shell__spacer" />
      <div>
        <div className="pair-shell__title">Welcome to ClipSync</div>
        <p className="pair-shell__body">Is this the first device you're setting up, or are you joining one that's already paired?</p>
      </div>
      {error && <p className="pair-shell__error">{error}</p>}
      <button type="button" className="pair-shell__cta" disabled={busy} onClick={handleFirstDevice}>
        This is my first device
      </button>
      <button
        type="button"
        className="pair-shell__cta pair-shell__cta--secondary"
        disabled={busy}
        onClick={() => navigate('/pair/scan')}
      >
        Join an existing pair
      </button>
      <div className="pair-shell__spacer" />
    </div>
  );
}
