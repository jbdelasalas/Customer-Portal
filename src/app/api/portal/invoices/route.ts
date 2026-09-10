import type { NextRequest } from 'next/server';
import { ok, handler } from '@/lib/api';
import { query, queryOne } from '@/lib/db';
import { requireCustomer } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/portal/invoices — the statement of account: open items with
 * ageing, recent payments, and the headline balance.
 *
 *   ?openOnly=true   only unsettled invoices
 */
export const GET = handler(async (request: NextRequest) => {
  const { customer } = await requireCustomer(request);
  const openOnly = request.nextUrl.searchParams.get('openOnly') === 'true';

  const invoices = await query(
    `SELECT i.id, i.invoice_no, i.invoice_date, i.due_date,
            i.total_amount, i.amount_paid, i.balance_due, i.currency,
            i.status, i.pdf_url, o.order_no,
            GREATEST(0, (CURRENT_DATE - i.due_date))::integer AS days_overdue
       FROM invoices i
       LEFT JOIN orders o ON o.id = i.order_id
      WHERE i.customer_id = $1
        AND i.status <> 'draft'
        AND ($2::boolean IS NOT TRUE OR (i.status IN ('open', 'partially_paid') AND i.balance_due > 0))
      ORDER BY i.invoice_date DESC, i.invoice_no DESC`,
    [customer.id, openOnly],
  );

  const balance = await queryOne<Record<string, string>>(
    `SELECT total_outstanding, current_amount, overdue_1_30, overdue_31_60,
            overdue_61_90, overdue_90_plus, credit_limit, available_credit
       FROM customer_balances WHERE customer_id = $1`,
    [customer.id],
  );

  const payments = await query(
    `SELECT id, payment_no, payment_date, method, reference_no, amount, status
       FROM payments
      WHERE customer_id = $1 AND status <> 'void'
      ORDER BY payment_date DESC
      LIMIT 20`,
    [customer.id],
  );

  return ok({
    invoices,
    payments,
    summary: {
      totalOutstanding: Number(balance?.total_outstanding ?? 0),
      current: Number(balance?.current_amount ?? 0),
      overdue1to30: Number(balance?.overdue_1_30 ?? 0),
      overdue31to60: Number(balance?.overdue_31_60 ?? 0),
      overdue61to90: Number(balance?.overdue_61_90 ?? 0),
      overdue90plus: Number(balance?.overdue_90_plus ?? 0),
      creditLimit: Number(balance?.credit_limit ?? 0),
      availableCredit: Number(balance?.available_credit ?? 0),
      currency: customer.currency,
    },
  });
});
