-- 005_catalog_orders.sql — the sellable catalogue, contract pricing, and the
-- order + delivery workflow.

-- ============================================================================
-- Products the portal can sell. Mastered in the ERP eventually; `erp_ref`
-- is the hook. Until then this table stands alone.
-- ============================================================================
CREATE TABLE IF NOT EXISTS products (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sku           varchar(60) NOT NULL,
  name          varchar(200) NOT NULL,
  description   text,
  category      varchar(80),
  uom           varchar(20) NOT NULL DEFAULT 'pc',
  -- Fallback when a customer has no contract price.
  list_price    numeric(18,4) NOT NULL DEFAULT 0,
  is_vatable    boolean NOT NULL DEFAULT true,
  min_order_qty numeric(18,3) NOT NULL DEFAULT 1,
  qty_increment numeric(18,3) NOT NULL DEFAULT 1,
  image_url     text,
  is_active     boolean NOT NULL DEFAULT true,
  erp_ref       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, sku)
);
SELECT attach_updated_at('products');

CREATE INDEX IF NOT EXISTS idx_products_active ON products (company_id, is_active, category);

-- ============================================================================
-- Per-customer contract pricing. Date-ranged so a price change is a new row,
-- preserving what a past order was actually quoted.
-- ============================================================================
CREATE TABLE IF NOT EXISTS customer_prices (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id    uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id     uuid NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
  unit_price     numeric(18,4) NOT NULL,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to   date,
  notes          text,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_prices_range CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
SELECT attach_updated_at('customer_prices');

-- At most one open-ended price per customer+product.
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_price_current
  ON customer_prices (customer_id, product_id) WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_customer_prices_lookup
  ON customer_prices (customer_id, product_id, effective_from DESC);

-- The price a customer sees today: contract price if any, else list price.
CREATE OR REPLACE FUNCTION effective_price(p_customer_id uuid, p_product_id uuid)
RETURNS numeric AS $$
DECLARE
  v_price numeric(18,4);
BEGIN
  SELECT unit_price INTO v_price
    FROM customer_prices
   WHERE customer_id = p_customer_id
     AND product_id  = p_product_id
     AND effective_from <= CURRENT_DATE
     AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
   ORDER BY effective_from DESC
   LIMIT 1;

  IF v_price IS NULL THEN
    SELECT list_price INTO v_price FROM products WHERE id = p_product_id;
  END IF;

  RETURN COALESCE(v_price, 0);
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- Orders
--
-- Delivery workflow (index = progress):
--   Pending -> Approved -> Allocated -> Truck Assigned ->
--   Ready to Dispatch -> Out for Delivery -> Delivered
-- Terminal off-ramps: Cancelled, Rejected
-- ============================================================================
CREATE TABLE IF NOT EXISTS orders (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  customer_id     uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  order_no        varchar(30) NOT NULL UNIQUE,

  site_id         uuid REFERENCES customer_sites(id) ON DELETE SET NULL,
  -- Snapshot, so a later edit to the site doesn't rewrite history.
  delivery_address text,

  status          varchar(30) NOT NULL DEFAULT 'Pending'
                  CHECK (status IN ('Draft', 'Pending', 'Approved', 'Allocated',
                                    'Truck Assigned', 'Ready to Dispatch',
                                    'Out for Delivery', 'Delivered',
                                    'Cancelled', 'Rejected')),
  priority        varchar(10) NOT NULL DEFAULT 'Standard'
                  CHECK (priority IN ('Standard', 'Rush')),

  requested_date  date,
  po_number       varchar(60),
  remarks         text,

  -- Money. Recomputed from lines by recalc_order_totals().
  subtotal        numeric(18,2) NOT NULL DEFAULT 0,
  vat_amount      numeric(18,2) NOT NULL DEFAULT 0,
  discount_amount numeric(18,2) NOT NULL DEFAULT 0,
  total_amount    numeric(18,2) NOT NULL DEFAULT 0,
  currency        varchar(3) NOT NULL DEFAULT 'PHP',

  -- Workflow stamps
  placed_by       uuid REFERENCES users(id),
  placed_at       timestamptz NOT NULL DEFAULT now(),
  approved_by     uuid REFERENCES users(id),
  approved_at     timestamptz,
  allocated_by    uuid REFERENCES users(id),
  allocated_at    timestamptz,
  truck_no        varchar(40),
  driver_name     varchar(160),
  driver_phone    varchar(40),
  truck_assigned_by uuid REFERENCES users(id),
  truck_assigned_at timestamptz,
  dispatched_by   uuid REFERENCES users(id),
  dispatched_at   timestamptz,
  dr_number       varchar(40),
  dr_photo_url    text,
  gps_url         text,
  delivered_at    timestamptz,
  received_by     varchar(160),
  cancel_reason   text,

  erp_ref         text,
  erp_synced_at   timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
SELECT attach_updated_at('orders');

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders (customer_id, placed_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_queue    ON orders (company_id, status, placed_at DESC);

CREATE TABLE IF NOT EXISTS order_lines (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id      uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  line_no       integer NOT NULL,
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  -- Snapshots taken at order time.
  sku           varchar(60)  NOT NULL,
  description   varchar(200) NOT NULL,
  uom           varchar(20)  NOT NULL,
  quantity      numeric(18,3) NOT NULL CHECK (quantity > 0),
  unit_price    numeric(18,4) NOT NULL CHECK (unit_price >= 0),
  discount_pct  numeric(6,3)  NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
  is_vatable    boolean NOT NULL DEFAULT true,
  line_total    numeric(18,2) NOT NULL DEFAULT 0,
  delivered_qty numeric(18,3) NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_order_lines ON order_lines (order_id);

-- Append-only order history, mirroring application_events.
CREATE TABLE IF NOT EXISTS order_events (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id      uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status   varchar(30),
  to_status     varchar(30),
  message       text,
  is_public     boolean NOT NULL DEFAULT true,
  actor_user_id uuid REFERENCES users(id),
  actor_label   varchar(160),
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_events ON order_events (order_id, created_at DESC);

-- ============================================================================
-- Order numbers: SO-YYYYMM-00123
-- ============================================================================
CREATE TABLE IF NOT EXISTS order_no_seq (
  period     varchar(6) PRIMARY KEY,
  last_value integer NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION next_order_no()
RETURNS varchar AS $$
DECLARE
  v_period varchar(6) := to_char(now(), 'YYYYMM');
  v_next   integer;
BEGIN
  INSERT INTO order_no_seq (period, last_value)
  VALUES (v_period, 1)
  ON CONFLICT (period) DO UPDATE
    SET last_value = order_no_seq.last_value + 1
  RETURNING last_value INTO v_next;

  RETURN 'SO-' || v_period || '-' || lpad(v_next::text, 5, '0');
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Totals. VAT is computed as 12% of the vatable, post-discount base.
-- Prices are treated as VAT-EXCLUSIVE.
-- ============================================================================
CREATE OR REPLACE FUNCTION recalc_order_totals(p_order_id uuid)
RETURNS void AS $$
DECLARE
  v_vat_rate numeric := 0.12;
BEGIN
  UPDATE order_lines
     SET line_total = ROUND(quantity * unit_price * (1 - discount_pct / 100.0), 2)
   WHERE order_id = p_order_id;

  UPDATE orders o
     SET subtotal   = COALESCE(t.net, 0),
         discount_amount = COALESCE(t.disc, 0),
         vat_amount = COALESCE(t.vatable, 0) * v_vat_rate,
         total_amount = COALESCE(t.net, 0) + COALESCE(t.vatable, 0) * v_vat_rate
    FROM (
      SELECT SUM(line_total) AS net,
             SUM(quantity * unit_price * (discount_pct / 100.0)) AS disc,
             SUM(CASE WHEN is_vatable THEN line_total ELSE 0 END) AS vatable
        FROM order_lines WHERE order_id = p_order_id
    ) t
   WHERE o.id = p_order_id;
END;
$$ LANGUAGE plpgsql;
