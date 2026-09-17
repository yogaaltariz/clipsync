import { useNavigate } from 'react-router';
import { LogoIcon, SettingsGearIcon } from './icons.js';
import './AppHeader.css';

export function AppHeader({
  online,
  deviceName,
  peerName,
}: {
  online: boolean;
  deviceName: string;
  peerName?: string;
}) {
  const navigate = useNavigate();
  return (
    <header className="app-header">
      <div className="app-header__row">
        <div className="app-header__brand">
          <LogoIcon />
          <span className="app-header__title">ClipSync</span>
        </div>
        <div className="app-header__actions">
          <div className={`app-header__status ${online ? 'app-header__status--online' : 'app-header__status--offline'}`}>
            <span className="app-header__status-dot" />
            <span className="app-header__status-label">{online ? 'Online' : 'Offline'}</span>
          </div>
          <button
            type="button"
            className="app-header__settings-button"
            aria-label="Settings"
            onClick={() => navigate('/settings')}
          >
            <SettingsGearIcon />
          </button>
        </div>
      </div>
      <div className="app-header__subtitle">
        <span className="app-header__device-name">{deviceName}</span>
        {peerName && <span className="app-header__peer-name">paired with {peerName}</span>}
      </div>
    </header>
  );
}
