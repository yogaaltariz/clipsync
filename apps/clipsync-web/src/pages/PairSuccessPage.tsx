import { useNavigate } from 'react-router';
import { useAppState } from '../lib/appState.js';
import { CheckCircleIcon, LockIcon } from '../components/icons.js';
import './PairShell.css';

export function PairSuccessPage() {
  const { peerDevices } = useAppState();
  const navigate = useNavigate();
  const peerName = peerDevices[0]?.deviceName ?? 'your other device';

  return (
    <div className="pair-shell">
      <span className="pair-shell__icon pair-shell__icon--success">
        <CheckCircleIcon />
      </span>
      <div>
        <div className="pair-shell__title">Device paired</div>
        <p className="pair-shell__body">This device is now paired with {peerName}.</p>
      </div>
      <div className="pair-shell__spacer" />
      <button type="button" className="pair-shell__cta" onClick={() => navigate('/main', { replace: true })}>
        Go to Clipboard
      </button>
      <div className="pair-shell__hint">
        <LockIcon />
        <span>Your clipboard stays on your local network.</span>
      </div>
    </div>
  );
}
