#!/usr/bin/env node
// Applies db/migrations/*.sql in filename order, once each, inside a
// transaction per file. Tracks what ran in schema_migrations.
//
//   node scripts/migrate.mjs            apply pending
//   node scripts/migrate.mjs --status   list applied/pending, apply nothing

import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'db', 'migrations');

function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    try {
      const text = readFileSync(join(__dirname, '..', file), 'utf8');
      for (const line of text.split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
        if (!m) continue;
        const value = m[2].replace(/^["']|["']$/g, '');
        if (!(m[1] in process.env)) process.env[m[1]] = value;
      }
    } catch {
      /* file absent — fine */
    }
  }
}

async function main() {
  loadEnv();
  const statusOnly = process.argv.includes('--status');

  // Migrations use the direct connection: DDL and the pooler disagree.
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    console.error('No DATABASE_URL or POSTGRES_URL set. Copy .env.example to .env.local first.');
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
  });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);

  const applied = new Map(
    (await client.query('SELECT filename, checksum FROM schema_migrations')).rows.map(
      (r) => [r.filename, r.checksum],
    ),
  );

  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  let ran = 0;

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex').slice(0, 16);

    if (applied.has(file)) {
      if (applied.get(file) !== checksum) {
        console.warn(`  ~ ${file} — CHANGED since it was applied (not re-run).`);
      } else if (statusOnly) {
        console.log(`  = ${file}`);
      }
      continue;
    }

    if (statusOnly) {
      console.log(`  + ${file} (pending)`);
      continue;
    }

    process.stdout.write(`  + ${file} ... `);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
        [file, checksum],
      );
      await client.query('COMMIT');
      console.log('ok');
      ran++;
    } catch (e) {
      await client.query('ROLLBACK');
      console.log('FAILED');
      console.error(`\n${file}: ${e.message}\n`);
      await client.end();
      process.exit(1);
    }
  }

  if (!statusOnly) {
    console.log(ran ? `\nApplied ${ran} migration(s).` : '\nAlready up to date.');
  }
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
