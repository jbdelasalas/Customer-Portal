import type { NextRequest } from 'next/server';
import { ok, err, handler } from '@/lib/api';
import { query, queryOne, transaction } from '@/lib/db';
import { requireCustomer } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Order matters: the index is the progress through the delivery workflow.
const STAGES = [
  'Pending',
  'Approved',
  'Allocated',
  'Truck Assigned',
  'Ready to Dispatch',
  'Out for Delivery',
  'Delivered',
] as const;

/** GET — one order with its lines and the delivery tracker. */
export const GET = handler(
  async (request: NextRequest, { params }: { params: { id: string } }) => {
    const { customer } = await requireCustomer(request);

    // The customer_id predicate is the tenancy boundary — never drop it.
    const order = await queryOne<Record<string, unknown> & { status: string }>(
      `SELECT o.id, o.order_no, o.status, o.priority, o.requested_date, o.po_number,
              o.remarks, o.delivery_address, o.subtotal, o.vat_amount,
              o.discount_amount, o.total_amount, o.currency,
              o.placed_at, o.approved_at, o.allocated_at, o.truck_assigned_at,
              o.dispatched_at, o.delivered_at, o.truck_no, o.driver_name,
              o.driver_phone, o.dr_number, o.dr_photo_url, o.gps_url,
              o.received_by, o.cancel_reason,
              s.name AS site_name
         FROM orders o
         LEFT JOIN customer_sites s ON s.id = o.site_id
        WHERE o.id = $1 AND o.customer_id = $2`,
      [params.id, customer.id],
    );

    if (!order) return err('Order not found.', 404);

    const lines = await query(
      `SELECT line_no, sku, description, uom, quantity, unit_price,
              discount_pct, line_total, delivered_qty, is_vatable
         FROM order_lines WHERE order_id = $1 ORDER BY line_no`,
      [params.id],
    );

    const events = await query(
      `SELECT from_status, to_status, message, actor_label, created_at
         FROM order_events
        WHERE order_id = $1 AND is_public
        ORDER BY created_at`,
      [params.id],
    );

    const currentIndex = STAGES.indexOf(order.status as (typeof STAGES)[number]);
    const isTerminal = ['Cancelled', 'Rejected'].includes(order.status);

    return ok({
      order,
      lines,
      events,
      tracking: {
        stages: STAGES,
        currentIndex,
        isTerminal,
        // -1 for a cancelled/rejected order, so the UI shows a stopped tracker.
        progress: isTerminal ? -1 : Math.max(0, currentIndex),
      },
    });
  },
);

/** DELETE — cancel an order, allowed only before it has been allocated. */
export const DELETE = handler(
  async (request: NextRequest, { params }: { params: { id: string } }) => {
    const { auth, customer } = await requireCustomer(request);

    const order = await queryOne<{ id: string; status: string; order_no: string }>(
      `SELECT id, status, order_no FROM orders WHERE id = $1 AND customer_id = $2`,
      [params.id, customer.id],
    );
    if (!order) return err('Order not found.', 404);

    // Once stock is allocated, cancelling is an operations decision.
    if (!['Pending', 'Approved'].includes(order.status)) {
      return err(
        `An order that is "${order.status}" can no longer be cancelled here. Please contact your account manager.`,
        409,
      );
    }

    const reason = await request
      .json()
      .then((b: { reason?: string }) => b?.reason ?? null)
      .catch(() => null);

    await transaction(async (client) => {
      await client.query(
        `UPDATE orders SET status = 'Cancelled', cancel_reason = $2 WHERE id = $1`,
        [order.id, reason],
      );
      await client.query(
        `INSERT INTO order_events (order_id, from_status, to_status, message, is_public, actor_user_id)
              VALUES ($1, $2, 'Cancelled', $3, true, $4)`,
        [order.id, order.status, reason ?? 'Cancelled by the customer.', auth.userId],
      );
    });

    return ok({ id: order.id, status: 'Cancelled' });
  },
);
