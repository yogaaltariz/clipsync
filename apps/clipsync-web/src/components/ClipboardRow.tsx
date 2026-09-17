import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ClipboardItemDto } from '../lib/apiClient.js';
import { useAppState } from '../lib/appState.js';
import { timeAgo } from '../lib/timeAgo.js';
import { ArrowRightIcon, CopyIcon, ImagePlaceholderIcon, LinkIcon, TextSnippetIcon } from './icons.js';
import './ClipboardList.css';

const URL_PATTERN = /^https?:\/\/\S+$/i;

export function ClipboardRow({ item }: { item: ClipboardItemDto }) {
  const { decryptItemText } = useAppState();
  const navigate = useNavigate();
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const isImage = item.contentType.startsWith('image/');

  useEffect(() => {
    if (isImage) return;
    let cancelled = false;
    decryptItemText(item)
      .then((text) => {
        if (!cancelled) setPlaintext(text);
      })
      .catch(() => {
        if (!cancelled) setPlaintext('(unable to decrypt)');
      });
    return () => {
      cancelled = true;
    };
  }, [item, isImage, decryptItemText]);

  if (isImage) {
    return (
      <button type="button" className="clipboard-row clipboard-row--clickable" onClick={() => navigate(`/item/${item.id}`)}>
        <span className="clipboard-row__icon">
          <ImagePlaceholderIcon />
        </span>
        <span className="clipboard-row__body">
          <span className="clipboard-row__content">{item.contentType}</span>
          <span className="clipboard-row__meta">
            {item.deviceName} · {timeAgo(item.createdAt)}
          </span>
        </span>
      </button>
    );
  }

  const isUrl = plaintext ? URL_PATTERN.test(plaintext.trim()) : false;
  const isCodeLike = plaintext ? /[{};=<>]/.test(plaintext) && !isUrl : false;

  async function handleCopy() {
    if (!plaintext) return;
    await navigator.clipboard.writeText(plaintext);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="clipboard-row">
      <span className="clipboard-row__icon">{isUrl ? <LinkIcon /> : <TextSnippetIcon />}</span>
      <span className="clipboard-row__body">
        <span className={`clipboard-row__content ${isCodeLike ? 'clipboard-row__content--mono' : ''}`}>
          {plaintext ?? 'Decrypting…'}
        </span>
        <span className="clipboard-row__meta">
          {item.deviceName} · {timeAgo(item.createdAt)}
        </span>
      </span>
      <span className="clipboard-row__actions">
        {isUrl && plaintext && (
          <button type="button" className="clipboard-row__button" onClick={() => window.open(plaintext, '_blank', 'noopener')}>
            Open <ArrowRightIcon size={12} />
          </button>
        )}
        <button
          type="button"
          className={`clipboard-row__button ${copied ? 'clipboard-row__button--copied' : ''}`}
          onClick={handleCopy}
          disabled={!plaintext}
        >
          {copied ? '✓ Copied' : (
            <>
              <CopyIcon size={14} /> Copy
            </>
          )}
        </button>
      </span>
    </div>
  );
}
