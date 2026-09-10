import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { ok, err, handler } from '@/lib/api';
import { query, queryOne, transaction } from '@/lib/db';
import { requireCustomer } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** GET /api/portal/orders — this customer's order history. */
export const GET = handler(async (request: NextRequest) => {
  const { customer } = await requireCustomer(request);

  const status = request.nextUrl.searchParams.get('status')?.trim() || null;
  const page = Math.max(1, Number(request.nextUrl.searchParams.get('page') ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get('pageSize') ?? 20)));

  const orders = await query(
    `SELECT o.id, o.order_no, o.status, o.priority, o.requested_date,
            o.po_number, o.total_amount, o.currency, o.placed_at,
            o.delivered_at, o.truck_no, o.dr_number,
            (SELECT count(*) FROM order_lines l WHERE l.order_id = o.id) AS line_count
       FROM orders o
      WHERE o.customer_id = $1
        AND ($2::text IS NULL OR o.status = $2)
      ORDER BY o.placed_at DESC
      LIMIT $3 OFFSET $4`,
    [customer.id, status, pageSize, (page - 1) * pageSize],
  );

  const counted = await queryOne<{ count: string }>(
    `SELECT count(*)::text AS count FROM orders
      WHERE customer_id = $1 AND ($2::text IS NULL OR status = $2)`,
    [customer.id, status],
  );

  return ok({ orders, page, pageSize, total: Number(counted?.count ?? 0) });
});

const CreateBody = z.object({
  siteId: z.string().uuid().optional(),
  requestedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  poNumber: z.string().max(60).optional(),
  priority: z.enum(['Standard', 'Rush']).default('Standard'),
  remarks: z.string().max(2000).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().positive(),
      }),
    )
    .min(1, 'An order needs at least one line.'),
});

/**
 * POST /api/portal/orders — place an order.
 *
 * Prices are resolved SERVER-SIDE from the contract price list; whatever the
 * client sends for price is ignored. Quantities are checked against each
 * product's minimum and increment, and the total against available credit.
 */
export const POST = handler(async (request: NextRequest) => {
  const { auth, customer } = await requireCustomer(request);

  if (customer.status === 'on_hold') {
    return err('This account is on hold. Please contact your account manager.', 403);
  }

  const parsed = CreateBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return err('Invalid order.', 400, {
      details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  const body = parsed.data;

  // Collapse duplicate lines for the same product into one.
  const wanted = new Map<string, number>();
  for (const line of body.lines) {
    wanted.set(line.productId, (wanted.get(line.productId) ?? 0) + line.quantity);
  }
  const productIds = [...wanted.keys()];

  const products = await query<{
    id: string;
    sku: string;
    name: string;
    uom: string;
    is_vatable: boolean;
    min_order_qty: string;
    qty_increment: string;
    unit_price: string;
  }>(
    `SELECT p.id, p.sku, p.name, p.uom, p.is_vatable, p.min_order_qty, p.qty_increment,
            effective_price($1, p.id) AS unit_price
       FROM products p
      WHERE p.id = ANY($2::uuid[]) AND p.company_id = $3 AND p.is_active`,
    [customer.id, productIds, customer.company_id],
  );

  if (products.length !== productIds.length) {
    return err('One or more products are unavailable.', 422);
  }

  const problems: { field: string; message: string }[] = [];
  for (const p of products) {
    const qty = wanted.get(p.id)!;
    const min = Number(p.min_order_qty);
    const step = Number(p.qty_increment);

    if (qty < min) {
      problems.push({ field: p.id, message: `${p.name}: minimum order is ${min} ${p.uom}.` });
    }
    // Tolerance keeps float arithmetic from rejecting a legitimate quantity.
    if (step > 0 && Math.abs((qty / step) - Math.round(qty / step)) > 1e-9) {
      problems.push({ field: p.id, message: `${p.name}: quantity must be a multiple of ${step}.` });
    }
  }
  if (problems.length) return err('Some quantities are invalid.', 422, { details: problems });

  // Credit check before we write anything.
  const estimated = products.reduce((sum, p) => {
    const qty = wanted.get(p.id)!;
    const net = qty * Number(p.unit_price);
    return sum + net + (p.is_vatable ? net * 0.12 : 0);
  }, 0);

  const balance = await queryOne<{ total_outstanding: string; available_credit: string }>(
    `SELECT total_outstanding, available_credit FROM customer_balances WHERE customer_id = $1`,
    [customer.id],
  );
  const creditLimit = Number(customer.credit_limit);
  const available = Number(balance?.available_credit ?? creditLimit);

  if (creditLimit > 0 && estimated > available) {
    return err(
      `This order (${estimated.toFixed(2)}) exceeds your available credit (${available.toFixed(2)}).`,
      422,
      { availableCredit: available, orderTotal: estimated },
    );
  }

  const site = body.siteId
    ? await queryOne<{ id: string; address: string }>(
        `SELECT id, address FROM customer_sites WHERE id = $1 AND customer_id = $2 AND is_active`,
        [body.siteId, customer.id],
      )
    : await queryOne<{ id: string; address: string }>(
        `SELECT id, address FROM customer_sites WHERE customer_id = $1 AND is_default AND is_active`,
        [customer.id],
      );

  if (body.siteId && !site) return err('That delivery site is not available.', 422);

  const created = await transaction(async (client) => {
    const noRow = await client.query<{ next_order_no: string }>('SELECT next_order_no()');
    const orderNo = noRow.rows[0].next_order_no;

    const order = await client.query<{ id: string }>(
      `INSERT INTO orders
         (company_id, customer_id, order_no, site_id, delivery_address,
          status, priority, requested_date, po_number, remarks, currency, placed_by)
       VALUES ($1, $2, $3, $4, $5, 'Pending', $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        customer.company_id,
        customer.id,
        orderNo,
        site?.id ?? null,
        site?.address ?? null,
        body.priority,
        body.requestedDate ?? null,
        body.poNumber ?? null,
        body.remarks ?? null,
        customer.currency,
        auth.userId,
      ],
    );
    const orderId = order.rows[0].id;

    let lineNo = 1;
    for (const p of products) {
      await client.query(
        `INSERT INTO order_lines
           (order_id, line_no, product_id, sku, description, uom, quantity, unit_price, is_vatable)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [orderId, lineNo++, p.id, p.sku, p.name, p.uom, wanted.get(p.id), p.unit_price, p.is_vatable],
      );
    }

    await client.query('SELECT recalc_order_totals($1)', [orderId]);

    await client.query(
      `INSERT INTO order_events (order_id, to_status, message, is_public, actor_user_id)
            VALUES ($1, 'Pending', 'Order placed via the customer portal.', true, $2)`,
      [orderId, auth.userId],
    );

    await client.query(
      `INSERT INTO notifications (user_id, title, body, category, link_url)
       SELECT DISTINCT u.id, 'New portal order',
              $2 || ' placed order ' || $3, 'order', '/staff/orders/' || $1::text
         FROM users u
         JOIN user_roles ur       ON ur.user_id = u.id
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p       ON p.id = rp.permission_id
        WHERE u.is_active AND u.user_type = 'staff' AND p.code = 'order.approve'`,
      [orderId, customer.name, orderNo],
    );

    const totals = await client.query<{ total_amount: string; subtotal: string; vat_amount: string }>(
      'SELECT subtotal, vat_amount, total_amount FROM orders WHERE id = $1',
      [orderId],
    );

    return { id: orderId, orderNo, ...totals.rows[0] };
  });

  return ok({ order: created }, 201);
});
