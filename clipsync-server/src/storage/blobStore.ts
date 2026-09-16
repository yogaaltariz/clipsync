import fs from 'node:fs/promises';
import path from 'node:path';

export function blobPathFor(blobDir: string, itemId: string): string {
  return path.join(blobDir, `${itemId}.bin`);
}

export async function writeBlob(blobDir: string, itemId: string, data: Buffer): Promise<string> {
  await fs.mkdir(blobDir, { recursive: true });
  const fullPath = blobPathFor(blobDir, itemId);
  await fs.writeFile(fullPath, data);
  return fullPath;
}

export async function readBlob(absolutePath: string): Promise<Buffer> {
  return fs.readFile(absolutePath);
}

export async function deleteBlob(absolutePath: string | null): Promise<void> {
  if (!absolutePath) return;
  await fs.rm(absolutePath, { force: true });
}
