#!/usr/bin/env node
// Seeds a company, a superadmin, and publishes v1 of the customer
// application form from db/seeds/customer_application_form.json.
// Idempotent: re-running updates the form to a new version only if the
// JSON actually changed, and never touches an existing admin's password.
//
//   node scripts/seed.mjs
//   SEED_ADMIN_EMAIL=me@x.com SEED_ADMIN_PASSWORD=... node scripts/seed.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    try {
      const text = readFileSync(join(ROOT, file), 'utf8');
      for (const line of text.split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
        if (!m) continue;
        const value = m[2].replace(/^["']|["']$/g, '');
        if (!(m[1] in process.env)) process.env[m[1]] = value;
      }
    } catch {
      /* absent — fine */
    }
  }
}

async function main() {
  loadEnv();
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    console.error('No DATABASE_URL or POSTGRES_URL set.');
    process.exit(1);
  }

  const companyCode = process.env.SEED_COMPANY_CODE || 'AFCC';
  const companyName = process.env.SEED_COMPANY_NAME || 'AFCC';
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!';

  const client = new pg.Client({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    await client.query('BEGIN');

    // --- Company -----------------------------------------------------------
    const company = await client.query(
      `INSERT INTO companies (code, name)
            VALUES ($1, $2)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id, code`,
      [companyCode, companyName],
    );
    const companyId = company.rows[0].id;
    console.log(`  company  ${company.rows[0].code}`);

    // --- Superadmin --------------------------------------------------------
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [adminEmail]);
    let adminId;
    if (existing.rows.length) {
      adminId = existing.rows[0].id;
      console.log(`  admin    ${adminEmail} (exists, password unchanged)`);
    } else {
      const hash = await bcrypt.hash(adminPassword, 10);
      const inserted = await client.query(
        `INSERT INTO users (email, password_hash, full_name, user_type, is_superadmin, email_verified_at)
              VALUES ($1, $2, $3, 'staff', true, now())
           RETURNING id`,
        [adminEmail, hash, 'Portal Administrator'],
      );
      adminId = inserted.rows[0].id;
      console.log(`  admin    ${adminEmail} / ${adminPassword}  <-- change this`);
    }

    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE code = 'superadmin'
       ON CONFLICT DO NOTHING`,
      [adminId],
    );

    // --- Customer application form ----------------------------------------
    const schema = JSON.parse(
      readFileSync(join(ROOT, 'db', 'seeds', 'customer_application_form.json'), 'utf8'),
    );

    const form = await client.query(
      `INSERT INTO forms (company_id, code, name, description, kind)
            VALUES ($1, 'customer_application', 'New Customer Application',
                    'Application form for opening a new customer account.', 'customer_application')
       ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
      [companyId],
    );
    const formId = form.rows[0].id;

    const current = await client.query(
      `SELECT id, version, schema FROM form_versions
        WHERE form_id = $1 AND status = 'published'
        ORDER BY version DESC LIMIT 1`,
      [formId],
    );

    const unchanged =
      current.rows.length &&
      JSON.stringify(current.rows[0].schema) === JSON.stringify(schema);

    if (unchanged) {
      console.log(`  form     v${current.rows[0].version} (unchanged)`);
    } else {
      const nextVersion = current.rows.length ? current.rows[0].version + 1 : 1;
      await client.query(
        `INSERT INTO form_versions (form_id, version, schema, status, changelog, published_at, published_by)
              VALUES ($1, $2, $3, 'published', $4, now(), $5)`,
        [
          formId,
          nextVersion,
          JSON.stringify(schema),
          nextVersion === 1 ? 'Initial version.' : 'Updated from db/seeds/customer_application_form.json',
          adminId,
        ],
      );
      if (current.rows.length) {
        await client.query(`UPDATE form_versions SET status = 'retired' WHERE id = $1`, [
          current.rows[0].id,
        ]);
      }
      console.log(`  form     v${nextVersion} published`);
    }

    await client.query('COMMIT');
    console.log('\nSeed complete.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(`\nSeed failed: ${e.message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
