import type { Database } from 'better-sqlite3';
import type { ClipboardItem } from '../types.js';

export interface ClipboardItemsRepo {
  insertItem(item: ClipboardItem): void;
  listItems(limit: number): ClipboardItem[];
  deleteItem(id: string): ClipboardItem | undefined;
  clearAll(): ClipboardItem[];
  evictOverLimit(limit: number): ClipboardItem[];
}

function rowToItem(row: any): ClipboardItem {
  return {
    id: row.id,
    contentType: row.content_type,
    ciphertext: row.ciphertext,
    blobPath: row.blob_path,
    deviceId: row.device_id,
    deviceName: row.device_name,
    createdAt: row.created_at,
  };
}

export function createClipboardItemsRepo(db: Database): ClipboardItemsRepo {
  return {
    insertItem(item) {
      db.prepare(
        `INSERT INTO clipboard_items (id, content_type, ciphertext, blob_path, device_id, device_name, created_at)
         VALUES (@id, @contentType, @ciphertext, @blobPath, @deviceId, @deviceName, @createdAt)`,
      ).run(item);
    },
    listItems(limit) {
      return db
        .prepare('SELECT * FROM clipboard_items ORDER BY created_at DESC, id DESC LIMIT ?')
        .all(limit)
        .map(rowToItem);
    },
    deleteItem(id) {
      const row = db.prepare('SELECT * FROM clipboard_items WHERE id = ?').get(id);
      if (!row) return undefined;
      db.prepare('DELETE FROM clipboard_items WHERE id = ?').run(id);
      return rowToItem(row);
    },
    clearAll() {
      const rows = db.prepare('SELECT * FROM clipboard_items').all().map(rowToItem);
      db.prepare('DELETE FROM clipboard_items').run();
      return rows;
    },
    evictOverLimit(limit) {
      const rows = db
        .prepare(
          `SELECT * FROM clipboard_items ORDER BY created_at DESC, id DESC
           LIMIT -1 OFFSET ?`,
        )
        .all(limit)
        .map(rowToItem);
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`DELETE FROM clipboard_items WHERE id IN (${placeholders})`).run(...ids);
      return rows.reverse(); // oldest first, matching the "evicted, in eviction order" contract
    },
  };
}
