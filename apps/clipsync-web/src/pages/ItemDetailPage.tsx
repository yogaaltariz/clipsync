import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useAppState } from '../lib/appState.js';
import { timeAgo } from '../lib/timeAgo.js';
import { BackArrowIcon, CopyIcon, TrashIcon } from '../components/icons.js';
import './ItemDetailPage.css';

export function ItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { items, downloadBlob, deleteItem } = useAppState();
  const navigate = useNavigate();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const item = items.find((candidate) => candidate.id === id);

  useEffect(() => {
    if (!id) return;
    let objectUrl: string | null = null;
    downloadBlob(id)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      })
      .catch(() => setError('Could not load this image.'));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, downloadBlob]);

  async function handleCopy() {
    if (!imageUrl || !item) return;
    try {
      const blob = await fetch(imageUrl).then((res) => res.blob());
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    } catch {
      window.open(imageUrl, '_blank', 'noopener');
    }
  }

  async function handleDelete() {
    if (!id) return;
    if (!window.confirm('Delete this item?')) return;
    await deleteItem(id);
    navigate('/main', { replace: true });
  }

  return (
    <div className="item-detail-page">
      <div className="item-detail-page__header">
        <button type="button" className="item-detail-page__back" aria-label="Back" onClick={() => navigate('/main')}>
          <BackArrowIcon />
        </button>
        <span className="item-detail-page__title">Image</span>
      </div>
      <div className="item-detail-page__frame">
        {imageUrl ? <img src={imageUrl} alt="Shared clipboard content" /> : <span>{error ?? 'Loading…'}</span>}
      </div>
      {item && (
        <div className="item-detail-page__meta">
          <span className="item-detail-page__filename">{item.contentType}</span>
          <span className="item-detail-page__timestamp">
            {item.deviceName} · {timeAgo(item.createdAt)}
          </span>
        </div>
      )}
      <div className="item-detail-page__actions">
        <button type="button" className="item-detail-page__button item-detail-page__button--primary" onClick={handleCopy}>
          <CopyIcon /> Copy
        </button>
        <button type="button" className="item-detail-page__button item-detail-page__button--secondary" onClick={handleDelete}>
          <TrashIcon /> Delete
        </button>
      </div>
    </div>
  );
}
