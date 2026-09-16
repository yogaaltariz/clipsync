import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export function openDb(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  const schemaPath = path.join(import.meta.dirname, 'schema.sql');
  db.exec(fs.readFileSync(schemaPath, 'utf8'));
  return db;
}
