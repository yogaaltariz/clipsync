import { useNavigate } from 'react-router';
import { useAppState } from '../lib/appState.js';
import { guessDeviceName } from '../lib/deviceName.js';
import { BackArrowIcon, CheckSmallIcon, LaptopIcon, LockIcon, PlusIcon, TrashIcon } from '../components/icons.js';
import './SettingsPage.css';

export function SettingsPage() {
  const { peerDevices, clearHistory, unpairDevice } = useAppState();
  const navigate = useNavigate();
  const thisDeviceName = guessDeviceName();

  async function handleUnpair(deviceId: string) {
    if (!window.confirm('Unpair this device? It will lose access to the shared clipboard immediately.')) return;
    await unpairDevice(deviceId);
  }

  async function handleClear() {
    if (!window.confirm("Remove every item on both devices? This can't be undone.")) return;
    await clearHistory();
  }

  return (
    <div className="settings-page">
      <div className="settings-page__header">
        <button type="button" className="settings-page__back" aria-label="Back" onClick={() => navigate('/main')}>
          <BackArrowIcon />
        </button>
        <span className="settings-page__title">Settings</span>
      </div>

      <div className="settings-page__section">
        <span className="settings-page__section-label">This device</span>
        <div className="settings-page__device-card">
          <span className="settings-page__device-label">Device name</span>
          <span className="settings-page__device-value">{thisDeviceName}</span>
        </div>
      </div>

      <div className="settings-page__section">
        <span className="settings-page__section-label">Paired devices</span>
        <div className="settings-page__device-row">
          <span className="settings-page__device-icon">
            <LaptopIcon />
          </span>
          <span className="settings-page__device-info">
            {thisDeviceName}
            <CheckSmallIcon />
          </span>
          <span className="settings-page__device-tag">This device</span>
        </div>
        {peerDevices.map((peer) => (
          <div className="settings-page__device-row" key={peer.deviceId}>
            <span className="settings-page__device-icon">
              <LaptopIcon />
            </span>
            <span className="settings-page__device-info">
              {peer.deviceName}
              <CheckSmallIcon />
            </span>
            <button type="button" className="settings-page__unpair" onClick={() => handleUnpair(peer.deviceId)}>
              Unpair
            </button>
          </div>
        ))}
      </div>

      {peerDevices.length === 0 && (
        <div className="settings-page__section">
          <button type="button" className="settings-page__pair-button" onClick={() => navigate('/pair/host')}>
            <PlusIcon /> Pair New Device
          </button>
        </div>
      )}

      <div className="settings-page__section">
        <span className="settings-page__section-label">Data</span>
        <div className="settings-page__data-row">
          <span>History limit</span>
          <span className="settings-page__device-label">50 items</span>
        </div>
        <span className="settings-page__data-hint">Oldest items are removed automatically once you pass the limit.</span>
      </div>

      <div className="settings-page__danger-zone">
        <button type="button" className="settings-page__clear-button" onClick={handleClear}>
          <TrashIcon /> Clear Clipboard History
        </button>
        <span className="settings-page__danger-hint">Removes every item on both devices. This can't be undone.</span>
      </div>

      <div className="settings-page__privacy">
        <LockIcon />
        <span>Your clipboard stays on your local network. Only paired devices with their own private key can read it.</span>
      </div>
    </div>
  );
}
