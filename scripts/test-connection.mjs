#!/usr/bin/env node
// Checks whether a Supabase connection string actually works, and says
// specifically what is wrong when it doesn't. Reads POSTGRES_URL /
// DATABASE_URL from .env.local, or takes a URL as an argument.
//
//   node scripts/test-connection.mjs
//   node scripts/test-connection.mjs "postgresql://postgres.ref:pw@host:5432/postgres"
//
// Nothing is written to the database and the password is never printed.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    try {
      for (const line of readFileSync(join(ROOT, file), 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
        if (m && !(m[1] in process.env)) {
          process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
      }
    } catch {
      /* absent — fine */
    }
  }
}

function describe(url) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: u.port || '5432',
      user: decodeURIComponent(u.username),
      hasPassword: Boolean(u.password),
      // Only the shape, never the value.
      passwordLength: u.password ? decodeURIComponent(u.password).length : 0,
    };
  } catch {
    return null;
  }
}

async function test(label, url) {
  const info = describe(url);
  console.log(`\n${label}`);

  if (!info) {
    console.log('  ✗ Not a valid URL. It should start with postgresql://');
    return false;
  }

  console.log(`  host      ${info.host}`);
  console.log(`  port      ${info.port}  ${info.port === '6543' ? '(transaction pooler)' : info.port === '5432' ? '(session/direct)' : ''}`);
  console.log(`  user      ${info.user}`);
  console.log(`  password  ${info.hasPassword ? `${info.passwordLength} characters` : 'MISSING'}`);

  if (!info.hasPassword) {
    console.log('  ✗ No password in the URL. Replace [YOUR-PASSWORD] with the real one.');
    return false;
  }
  if (/\[YOUR-PASSWORD\]/i.test(url)) {
    console.log('  ✗ The URL still contains the [YOUR-PASSWORD] placeholder.');
    return false;
  }

  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
  });

  try {
    await client.connect();
    const r = await client.query(
      `SELECT current_database() AS db,
              (SELECT count(*)::int FROM information_schema.tables
                WHERE table_schema = 'public') AS tables`,
    );
    console.log(`  ✓ CONNECTED — database "${r.rows[0].db}", ${r.rows[0].tables} table(s) in public`);
    if (r.rows[0].tables === 0) {
      console.log('    Empty, as expected for a new project. Run: npm run db:migrate');
    }
    await client.end();
    return true;
  } catch (e) {
    const m = e.message.split('\n')[0];
    console.log(`  ✗ ${m}`);

    if (/password authentication failed/i.test(m)) {
      console.log('    The host and project are correct, but the password is not.');
      console.log('    Supabase → Settings → Database → Reset database password.');
      console.log('    Use the DATABASE password, not the anon/service_role key.');
      console.log('    Avoid % @ / # ? in it — they need URL-encoding.');
    } else if (/Tenant or user not found/i.test(m)) {
      console.log('    That project ref is not on this host. Copy the URI from');
      console.log('    Supabase → Connect rather than editing it by hand.');
    } else if (/ENOTFOUND|EAI_AGAIN/i.test(m)) {
      console.log('    Hostname did not resolve. Check for a typo, or no internet.');
    } else if (/timeout/i.test(m)) {
      console.log('    Timed out — the project may be paused. Check the dashboard.');
    }
    try { await client.end(); } catch {}
    return false;
  }
}

loadEnv();

const arg = process.argv[2];
let allOk = true;

if (arg) {
  allOk = await test('Supplied URL', arg);
} else {
  const urls = [
    ['POSTGRES_URL  (runtime)', process.env.POSTGRES_URL],
    ['DATABASE_URL  (migrations)', process.env.DATABASE_URL],
  ].filter(([, v]) => v);

  if (urls.length === 0) {
    console.log('\nNeither POSTGRES_URL nor DATABASE_URL is set in .env.local.');
    console.log('Paste the URI from Supabase → Connect, then run this again.\n');
    process.exit(1);
  }
  for (const [label, url] of urls) {
    if (!(await test(label, url))) allOk = false;
  }
}

console.log(allOk ? '\nReady. Next: npm run db:migrate\n' : '\nFix the above, then run this again.\n');
process.exit(allOk ? 0 : 1);
