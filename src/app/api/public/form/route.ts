import type { NextRequest } from 'next/server';
import { ok, err, handler } from '@/lib/api';
import { queryOne } from '@/lib/db';
import type { FormSchema } from '@/lib/forms';

export const dynamic = 'force-dynamic';

interface FormVersionRow {
  form_version_id: string;
  version: number;
  form_name: string;
  description: string | null;
  company_id: string;
  company_name: string;
  company_code: string;
  short_name: string | null;
  schema: FormSchema;
}

/**
 * Returns the currently published application form so the sign-up page can
 * render it. Public on purpose — it is a blank form, no customer data.
 *
 *   GET /api/public/form?company=PPC
 *
 * When no company is named, the default company answers (companies.is_default,
 * which a unique index keeps to a single row). This previously fell through to
 * `ORDER BY fv.version DESC LIMIT 1` across every company, which was correct
 * only while there was one: with two, it returns whichever company most
 * recently published a higher version number. An applicant could then be shown
 * another company's form and have their application filed under that
 * company_id — wrong, and invisible until someone noticed a fuel customer in
 * the poultry book. Resolving an explicit default makes that impossible rather
 * than unlikely.
 */
export const GET = handler(async (request: NextRequest) => {
  const companyCode = request.nextUrl.searchParams.get('company');

  const row = await queryOne<FormVersionRow>(
    `SELECT fv.id AS form_version_id, fv.version, fv.schema,
            f.name AS form_name, f.description,
            co.id AS company_id, co.name AS company_name,
            co.code AS company_code, co.short_name
       FROM form_versions fv
       JOIN forms f      ON f.id = fv.form_id
       JOIN companies co ON co.id = f.company_id
      WHERE fv.status = 'published'
        AND f.is_active
        AND f.kind = 'customer_application'
        AND co.is_active
        AND CASE WHEN $1::text IS NULL THEN co.is_default
                 ELSE upper(co.code) = upper($1) END
      ORDER BY fv.version DESC
      LIMIT 1`,
    [companyCode],
  );

  if (!row) {
    // Name the company back when one was asked for, so a mistyped or
    // unpublished code is distinguishable from nothing being published at all.
    return err(
      companyCode
        ? `No published application form for company "${companyCode}".`
        : 'No application form is published yet.',
      404,
    );
  }

  return ok({
    formVersionId: row.form_version_id,
    version: row.version,
    name: row.form_name,
    description: row.description,
    company: {
      id: row.company_id,
      code: row.company_code,
      name: row.company_name,
      shortName: row.short_name ?? row.company_name,
    },
    schema: row.schema,
  });
});
