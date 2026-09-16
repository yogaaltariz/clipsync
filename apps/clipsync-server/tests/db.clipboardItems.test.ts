import { afterEach, describe, expect, it } from 'vitest';
import { buildTestServer } from './helpers/testServer.js';
import { createClipboardItemsRepo } from '../src/db/clipboardItems.repo.js';
import { createDevicesRepo } from '../src/db/devices.repo.js';
import { generateDeviceKeys } from './helpers/testKeys.js';
import type { ClipboardItem } from '../src/types.js';

describe('clipboardItems repo', () => {
  let ctx: ReturnType<typeof buildTestServer>;
  afterEach(() => ctx?.cleanup());

  function seedDevice() {
    const devices = createDevicesRepo(ctx.db);
    const keys = generateDeviceKeys();
    devices.insertDevice({
      deviceId: 'device-1',
      deviceName: 'Mac',
      publicKeyAuthJwk: keys.publicKeyAuthJwk,
      publicKeyExchangeJwk: keys.publicKeyExchangeJwk,
      pairedAt: new Date().toISOString(),
      revokedAt: null,
    });
  }

  function makeItem(overrides: Partial<ClipboardItem> = {}): ClipboardItem {
    return {
      id: overrides.id ?? crypto.randomUUID(),
      contentType: 'text/plain',
      ciphertext: 'opaque-ciphertext',
      blobPath: null,
      deviceId: 'device-1',
      deviceName: 'Mac',
      createdAt: overrides.createdAt ?? new Date().toISOString(),
      ...overrides,
    };
  }

  it('lists items newest first', () => {
    ctx = buildTestServer();
    seedDevice();
    const repo = createClipboardItemsRepo(ctx.db);
    repo.insertItem(makeItem({ id: 'a', createdAt: '2026-01-01T00:00:00.000Z' }));
    repo.insertItem(makeItem({ id: 'b', createdAt: '2026-01-02T00:00:00.000Z' }));
    const items = repo.listItems(50);
    expect(items.map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('deletes an item and returns the deleted row', () => {
    ctx = buildTestServer();
    seedDevice();
    const repo = createClipboardItemsRepo(ctx.db);
    repo.insertItem(makeItem({ id: 'a' }));
    const deleted = repo.deleteItem('a');
    expect(deleted?.id).toBe('a');
    expect(repo.listItems(50)).toHaveLength(0);
  });

  it('clears all items and returns every deleted row', () => {
    ctx = buildTestServer();
    seedDevice();
    const repo = createClipboardItemsRepo(ctx.db);
    repo.insertItem(makeItem({ id: 'a' }));
    repo.insertItem(makeItem({ id: 'b' }));
    const cleared = repo.clearAll();
    expect(cleared).toHaveLength(2);
    expect(repo.listItems(50)).toHaveLength(0);
  });

  it('evicts only items beyond the limit, oldest first', () => {
    ctx = buildTestServer();
    seedDevice();
    const repo = createClipboardItemsRepo(ctx.db);
    for (let i = 0; i < 5; i++) {
      repo.insertItem(makeItem({ id: `item-${i}`, createdAt: `2026-01-0${i + 1}T00:00:00.000Z` }));
    }
    const evicted = repo.evictOverLimit(3);
    expect(evicted.map((i) => i.id)).toEqual(['item-0', 'item-1']);
    expect(repo.listItems(50)).toHaveLength(3);
  });
});
