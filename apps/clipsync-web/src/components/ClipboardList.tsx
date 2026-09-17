import type { ClipboardItemDto } from '../lib/apiClient.js';
import { ClipboardRow } from './ClipboardRow.js';
import './ClipboardList.css';

export function ClipboardList({ items, historyLimit }: { items: ClipboardItemDto[]; historyLimit: number }) {
  return (
    <div className="clipboard-list">
      <div className="clipboard-list__header">
        <div className="clipboard-list__header-left">
          <span className="clipboard-list__title">Recent</span>
          <span className="clipboard-list__count">
            {items.length} of {historyLimit}
          </span>
        </div>
        <span className="clipboard-list__order">Newest first</span>
      </div>
      {items.map((item) => (
        <ClipboardRow key={item.id} item={item} />
      ))}
    </div>
  );
}
