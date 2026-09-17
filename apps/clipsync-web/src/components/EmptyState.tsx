import { useNavigate } from 'react-router';
import { ImagePlaceholderIcon, PlusIcon } from './icons.js';
import './EmptyState.css';

export function EmptyState({ peerName, hasPeer }: { peerName?: string; hasPeer: boolean }) {
  const navigate = useNavigate();

  if (!hasPeer) {
    return (
      <div className="empty-state">
        <span className="empty-state__icon">
          <ImagePlaceholderIcon size={26} />
        </span>
        <div>
          <div className="empty-state__title">No device paired yet</div>
          <p className="empty-state__body">Pair your Mac and phone to start sharing clipboard items between them.</p>
        </div>
        <button type="button" className="empty-state__action" onClick={() => navigate('/settings')}>
          <PlusIcon size={16} /> Pair a device
        </button>
      </div>
    );
  }

  return (
    <div className="empty-state">
      <span className="empty-state__icon">
        <ImagePlaceholderIcon size={26} />
      </span>
      <div>
        <div className="empty-state__title">Nothing shared yet</div>
        <p className="empty-state__body">
          Copy something on this device, then tap Paste from Clipboard below. It appears on {peerName ?? 'your other device'} in
          under a second, ready to copy.
        </p>
      </div>
    </div>
  );
}
