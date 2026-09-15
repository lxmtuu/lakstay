#!/usr/bin/env node
/** Tạo/reset schema. Dùng: npm run db:init  (thêm --fresh để xoá data) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dbFile = process.env.DB_FILE || path.join(root, 'src', 'data', 'lakstay.db');
const fresh = process.argv.includes('--fresh');

fs.mkdirSync(path.dirname(dbFile), { recursive: true });

if (fresh) {
  for (const suffix of ['', '-wal', '-shm']) {
    const f = dbFile + suffix;
    if (fs.existsSync(f)) { fs.rmSync(f); console.log(`removed ${f}`); }
  }
}

const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(path.join(root, 'db', 'schema.sql'), 'utf8'));

const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all();
console.log(`\n✓ Schema sẵn sàng tại ${dbFile}`);
console.log(`  ${tables.length} bảng: ${tables.map((t) => t.name).join(', ')}\n`);
db.close();
