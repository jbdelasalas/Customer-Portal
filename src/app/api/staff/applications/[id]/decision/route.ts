import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { ok, err, handler } from '@/lib/api';
import { queryOne, transaction } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { mapToCustomer, type FormSchema } from '@/lib/forms';
import { send, applicationApprovedMail, infoRequestedMail } from '@/lib/mail';

export const dynamic = 'force-dynamic';

const Body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
    notes: z.string().max(2000).optional(),
    paymentTermsDays: z.number().int().min(0).max(365).optional(),
    creditLimit: z.number().min(0).optional(),
    priceTier: z.string().max(40).optional(),
  }),
  z.object({
    action: z.literal('reject'),
    notes: z.string().min(1, 'A reason is required when rejecting.').max(2000),
  }),
  z.object({
    action: z.literal('request_info'),
    notes: z.string().min(1, 'Say what is needed.').max(2000),
  }),
  z.object({
    action: z.literal('start_review'),
    notes: z.string().max(2000).optional(),
  }),
]);

interface AppRow {
  id: string;
  company_id: string;
  status: string;
  data: Record<string, unknown>;
  business_name: string | null;
  applicant_user_id: string | null;
  applicant_email: string;
  applicant_name: string | null;
  applicant_phone: string | null;
  customer_id: string | null;
  schema: FormSchema;
}

/**
 * POST /api/staff/applications/:id/decision
 *
 * Approving does four things in ONE transaction: create the customer, link
 * the applicant's login to it, stamp the application, and notify. A partial
 * apply here would leave someone approved but unable to log in, so it must be
 * all-or-nothing.
 */
export const POST = handler(
  async (request: NextRequest, { params }: { params: { id: string } }) => {
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return err('Invalid decision.', 400, {
        details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    const body = parsed.data;

    // Approve/reject is a higher bar than commenting on an application.
    const permission =
      body.action === 'approve' || body.action === 'reject'
        ? 'application.approve'
        : 'application.review';
    const auth = await requireStaff(request, permission);

    const app = await queryOne<AppRow>(
      `SELECT a.id, a.company_id, a.status, a.data, a.business_name,
              a.applicant_user_id, a.applicant_email, a.applicant_name,
              a.applicant_phone, a.customer_id, fv.schema
         FROM applications a
         JOIN form_versions fv ON fv.id = a.form_version_id
        WHERE a.id = $1`,
      [params.id],
    );
    if (!app) return err('Application not found.', 404);

    if (['approved', 'rejected', 'withdrawn'].includes(app.status)) {
      return err(`This application is already ${app.status}.`, 409);
    }
    if (app.status === 'draft') {
      return err('This application has not been submitted yet.', 409);
    }

    const actorLabel = auth.email;

    // ---- non-terminal transitions -----------------------------------------
    if (body.action === 'start_review' || body.action === 'request_info') {
      const toStatus = body.action === 'start_review' ? 'under_review' : 'info_requested';

      await transaction(async (client) => {
        await client.query(
          `UPDATE applications SET status = $2, reviewed_by = $3, reviewed_at = now()
            WHERE id = $1`,
          [app.id, toStatus, auth.userId],
        );
        await client.query(
          `INSERT INTO application_events
             (application_id, event_type, from_status, to_status, message, is_public, actor_user_id, actor_label)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            app.id,
            body.action === 'start_review' ? 'assigned' : 'info_requested',
            app.status,
            toStatus,
            body.notes ?? null,
            body.action === 'request_info',
            auth.userId,
            actorLabel,
          ],
        );

        if (body.action === 'request_info' && app.applicant_user_id) {
          await client.query(
            `INSERT INTO notifications (user_id, title, body, category, link_url)
                  VALUES ($1, 'More information needed', $2, 'application', $3)`,
            [app.applicant_user_id, body.notes, `/apply/${app.id}`],
          );
        }
      });

      // Emailed after the transaction, so a provider outage cannot roll back
      // a decision that has already been recorded.
      if (body.action === 'request_info') {
        send(infoRequestedMail(app.applicant_email, body.notes, app.id)).catch(() => {});
      }

      return ok({ id: app.id, status: toStatus });
    }

    // ---- rejection ---------------------------------------------------------
    if (body.action === 'reject') {
      await transaction(async (client) => {
        await client.query(
          `UPDATE applications
              SET status = 'rejected', decided_by = $2, decided_at = now(), decision_notes = $3
            WHERE id = $1`,
          [app.id, auth.userId, body.notes],
        );
        await client.query(
          `INSERT INTO application_events
             (application_id, event_type, from_status, to_status, message, is_public, actor_user_id, actor_label)
           VALUES ($1, 'rejected', $2, 'rejected', $3, true, $4, $5)`,
          [app.id, app.status, body.notes, auth.userId, actorLabel],
        );
        if (app.applicant_user_id) {
          await client.query(
            `INSERT INTO notifications (user_id, title, body, category, link_url)
                  VALUES ($1, 'Application not approved', $2, 'application', $3)`,
            [app.applicant_user_id, body.notes, `/apply/${app.id}`],
          );
        }
      });

      return ok({ id: app.id, status: 'rejected' });
    }

    // ---- approval ----------------------------------------------------------
    const patch = mapToCustomer(app.schema, app.data);

    // `name` is what the rest of the system displays; fall back through the
    // likely form fields so an approved customer is never nameless.
    const name =
      (patch.name as string) ??
      (patch.legal_name as string) ??
      app.business_name ??
      app.applicant_name ??
      app.applicant_email;

    const result = await transaction(async (client) => {
      const codeRow = await client.query<{ next_customer_code: string }>(
        'SELECT next_customer_code($1)',
        [app.company_id],
      );
      const code = codeRow.rows[0].next_customer_code;

      const columns = Object.keys(patch).filter((c) => c !== 'name');
      const values = columns.map((c) => patch[c]);

      // Build the insert from the schema-driven patch, with the fixed columns
      // first so their positions are stable.
      const fixed = ['company_id', 'code', 'name', 'application_id', 'created_by'];
      const fixedValues = [app.company_id, code, name, app.id, auth.userId];
      const allColumns = [...fixed, ...columns];
      const allValues = [...fixedValues, ...values];
      const placeholders = allColumns.map((_, i) => `$${i + 1}`).join(', ');

      const inserted = await client.query<{ id: string; code: string }>(
        `INSERT INTO customers (${allColumns.join(', ')})
              VALUES (${placeholders})
           RETURNING id, code`,
        allValues,
      );
      const customerId = inserted.rows[0].id;

      // Commercial terms are the reviewer's call, never the applicant's.
      if (
        body.paymentTermsDays !== undefined ||
        body.creditLimit !== undefined ||
        body.priceTier !== undefined
      ) {
        await client.query(
          `UPDATE customers
              SET payment_terms_days = COALESCE($2, payment_terms_days),
                  credit_limit       = COALESCE($3, credit_limit),
                  price_tier         = COALESCE($4, price_tier)
            WHERE id = $1`,
          [customerId, body.paymentTermsDays ?? null, body.creditLimit ?? null, body.priceTier ?? null],
        );
      }

      // Seed a default delivery site from the application's shipping address.
      const shipping = (patch.shipping_address as string) ?? (patch.billing_address as string);
      if (shipping) {
        await client.query(
          `INSERT INTO customer_sites (customer_id, name, address, city, province, contact_person, phone, is_default)
                VALUES ($1, 'Main', $2, $3, $4, $5, $6, true)`,
          [
            customerId,
            shipping,
            (patch.city as string) ?? null,
            (patch.province as string) ?? null,
            (patch.contact_person as string) ?? null,
            (patch.phone as string) ?? (patch.mobile as string) ?? null,
          ],
        );
      }

      await client.query(
        `UPDATE applications
            SET status = 'approved', decided_by = $2, decided_at = now(),
                decision_notes = $3, customer_id = $4
          WHERE id = $1`,
        [app.id, auth.userId, body.notes ?? null, customerId],
      );

      // This is the step that actually unlocks the portal for the applicant.
      if (app.applicant_user_id) {
        await client.query(
          `UPDATE users SET customer_id = $2 WHERE id = $1 AND user_type = 'customer'`,
          [app.applicant_user_id, customerId],
        );
        await client.query(
          `INSERT INTO notifications (user_id, title, body, category, link_url)
                VALUES ($1, 'Your account is approved',
                        'Welcome aboard. Your customer code is ' || $2 || '. You can now place orders.',
                        'application', '/portal')`,
          [app.applicant_user_id, inserted.rows[0].code],
        );
      }

      await client.query(
        `INSERT INTO application_events
           (application_id, event_type, from_status, to_status, message, is_public, actor_user_id, actor_label, metadata)
         VALUES ($1, 'approved', $2, 'approved', $3, true, $4, $5, $6)`,
        [
          app.id,
          app.status,
          body.notes ?? 'Application approved.',
          auth.userId,
          actorLabel,
          JSON.stringify({ customerId, customerCode: inserted.rows[0].code }),
        ],
      );

      return { customerId, code: inserted.rows[0].code };
    });

    send(
      applicationApprovedMail(app.applicant_email, result.code, app.applicant_name ?? undefined),
    ).catch(() => {});

    return ok({
      id: app.id,
      status: 'approved',
      customer: { id: result.customerId, code: result.code, name },
    });
  },
);
