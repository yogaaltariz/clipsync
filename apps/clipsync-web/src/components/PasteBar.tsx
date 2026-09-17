import { useState } from 'react';
import { useAppState } from '../lib/appState.js';
import { LockIcon } from './icons.js';
import './PasteBar.css';

export function PasteBar({ hasPeer }: { hasPeer: boolean }) {
  const { addTextItem, addImageItem } = useAppState();
  const [manualMode, setManualMode] = useState(false);
  const [manualText, setManualText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function tryReadImageOrText(): Promise<boolean> {
    if (navigator.clipboard.read) {
      try {
        const clipboardItems = await navigator.clipboard.read();
        for (const clipboardItem of clipboardItems) {
          const imageType = clipboardItem.types.find((type) => type.startsWith('image/'));
          if (imageType) {
            const blob = await clipboardItem.getType(imageType);
            await addImageItem(blob);
            return true;
          }
        }
      } catch {
        // permission denied or unsupported — fall through to text
      }
    }
    const text = await navigator.clipboard.readText();
    if (!text) return false;
    await addTextItem(text);
    return true;
  }

  async function handleAutoPaste() {
    if (!hasPeer || busy) return;
    setBusy(true);
    setError(null);
    try {
      const handled = await tryReadImageOrText();
      if (!handled) setManualMode(true);
    } catch (err) {
      if (err instanceof DOMException) {
        setManualMode(true);
      } else {
        setError('Could not reach the paired device. Check your connection and try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleManualSubmit() {
    if (!manualText.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await addTextItem(manualText);
      setManualText('');
      setManualMode(false);
    } catch {
      setError('Could not reach the paired device. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="paste-bar">
      {manualMode && (
        <div className="paste-bar__manual">
          <div className="paste-bar__manual-hint">
            <LockIcon />
            <span>Clipboard access isn't available. Paste your content manually instead.</span>
          </div>
          <textarea
            className="paste-bar__textarea"
            placeholder="Paste something here..."
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
          />
        </div>
      )}
      <button
        type="button"
        className={`paste-bar__cta ${hasPeer ? 'paste-bar__cta--active' : 'paste-bar__cta--disabled'}`}
        disabled={!hasPeer || busy}
        onClick={manualMode ? handleManualSubmit : handleAutoPaste}
      >
        {manualMode ? 'Add to Clipboard' : 'Paste from Clipboard'}
      </button>
      {error && <div className="paste-bar__error">{error}</div>}
      <div className="paste-bar__privacy">
        <LockIcon size={12} />
        <span>Your clipboard stays on your local network.</span>
      </div>
    </div>
  );
}
