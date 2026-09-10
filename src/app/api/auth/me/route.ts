import type { NextRequest } from 'next/server';
import { ok, handler } from '@/lib/api';
import { queryOne } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface MeRow {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  user_type: 'customer' | 'staff';
  customer_id: string | null;
  is_superadmin: boolean;
  email_verified_at: string | null;
  customer_code: string | null;
  customer_name: string | null;
  customer_status: string | null;
}

/** The session bootstrap every page calls on load. */
export const GET = handler(async (request: NextRequest) => {
  const auth = await requireAuth(request);

  const row = await queryOne<MeRow>(
    `SELECT u.id, u.email, u.full_name, u.phone, u.user_type, u.customer_id,
            u.is_superadmin, u.email_verified_at,
            c.code AS customer_code, c.name AS customer_name, c.status AS customer_status
       FROM users u
       LEFT JOIN customers c ON c.id = u.customer_id
      WHERE u.id = $1 AND u.is_active`,
    [auth.userId],
  );

  if (!row) {
    return ok({ user: null }, 401);
  }

  // A customer with no linked customer record is mid-onboarding: tell the UI
  // where to send them.
  const pendingApplication =
    row.user_type === 'customer' && !row.customer_id
      ? await queryOne<{ id: string; reference_no: string; status: string }>(
          `SELECT id, reference_no, status FROM applications
            WHERE applicant_user_id = $1
            ORDER BY created_at DESC LIMIT 1`,
          [auth.userId],
        )
      : null;

  return ok({
    user: {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      phone: row.phone,
      userType: row.user_type,
      isSuperadmin: row.is_superadmin,
      emailVerified: Boolean(row.email_verified_at),
      permissions: auth.permissions,
      customer: row.customer_id
        ? { id: row.customer_id, code: row.customer_code, name: row.customer_name, status: row.customer_status }
        : null,
    },
    application: pendingApplication,
  });
});
