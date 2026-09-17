import { AppHeader } from '../components/AppHeader.js';
import { ClipboardList } from '../components/ClipboardList.js';
import { EmptyState } from '../components/EmptyState.js';
import { PasteBar } from '../components/PasteBar.js';
import { useAppState } from '../lib/appState.js';
import { guessDeviceName } from '../lib/deviceName.js';
import './MainPage.css';

const HISTORY_LIMIT = 50;

export function MainPage() {
  const { peerDevices, items, connectionStatus } = useAppState();
  const hasPeer = peerDevices.length > 0;
  const peerName = peerDevices[0]?.deviceName;

  return (
    <div className="main-page">
      <AppHeader online={connectionStatus === 'open'} deviceName={guessDeviceName()} peerName={peerName} />
      {!hasPeer || items.length === 0 ? (
        <EmptyState hasPeer={hasPeer} peerName={peerName} />
      ) : (
        <ClipboardList items={items} historyLimit={HISTORY_LIMIT} />
      )}
      {hasPeer && <PasteBar hasPeer={hasPeer} />}
    </div>
  );
}
