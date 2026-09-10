import type { NextRequest } from 'next/server';
import { ok, handler } from '@/lib/api';
import { query } from '@/lib/db';
import { requireCustomer } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/portal/products — the catalogue as this customer sees it, each
 * item already priced at their contract rate (or list price if none).
 */
export const GET = handler(async (request: NextRequest) => {
  const { customer } = await requireCustomer(request);

  const search = request.nextUrl.searchParams.get('q')?.trim() || null;
  const category = request.nextUrl.searchParams.get('category')?.trim() || null;

  const products = await query(
    `SELECT p.id, p.sku, p.name, p.description, p.category, p.uom,
            p.image_url, p.is_vatable, p.min_order_qty, p.qty_increment,
            effective_price($1, p.id) AS unit_price,
            (effective_price($1, p.id) <> p.list_price) AS is_contract_price
       FROM products p
      WHERE p.company_id = $2
        AND p.is_active
        AND ($3::text IS NULL OR p.name ILIKE '%' || $3 || '%' OR p.sku ILIKE '%' || $3 || '%')
        AND ($4::text IS NULL OR p.category = $4)
      ORDER BY p.category NULLS LAST, p.name`,
    [customer.id, customer.company_id, search, category],
  );

  const categories = await query<{ category: string }>(
    `SELECT DISTINCT category FROM products
      WHERE company_id = $1 AND is_active AND category IS NOT NULL
      ORDER BY category`,
    [customer.company_id],
  );

  return ok({
    products,
    categories: categories.map((c) => c.category),
    currency: customer.currency,
  });
});
