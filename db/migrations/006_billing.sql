-- 006_billing.sql — invoices, payments, and the customer statement.
--
-- This is a customer-facing AR *mirror*, not a general ledger. It answers
-- "what do I owe and what have I paid?". Accounting stays in the ERP.

CREATE TABLE IF NOT EXISTS invoices (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  customer_id    uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  order_id       uuid REFERENCES orders(id) ON DELETE SET NULL,

  invoice_no     varchar(40) NOT NULL,
  invoice_date   date NOT NULL DEFAULT CURRENT_DATE,
  due_date       date NOT NULL,

  subtotal       numeric(18,2) NOT NULL DEFAULT 0,
  vat_amount     numeric(18,2) NOT NULL DEFAULT 0,
  total_amount   numeric(18,2) NOT NULL DEFAULT 0,
  amount_paid    numeric(18,2) NOT NULL DEFAULT 0,
  -- Kept as a stored column so statement queries stay simple and indexable.
  balance_due    numeric(18,2) GENERATED ALWAYS AS (total_amount - amount_paid) STORED,
  currency       varchar(3) NOT NULL DEFAULT 'PHP',

  status         varchar(20) NOT NULL DEFAULT 'open'
                 CHECK (status IN ('draft', 'open', 'partially_paid', 'paid', 'void')),

  pdf_url        text,
  notes          text,
  erp_ref        text,
  erp_synced_at  timestamptz,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, invoice_no)
);
SELECT attach_updated_at('invoices');

CREATE INDEX IF NOT EXISTS idx_invoices_customer
  ON invoices (customer_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_open
  ON invoices (customer_id, due_date) WHERE status IN ('open', 'partially_paid');

CREATE TABLE IF NOT EXISTS invoice_lines (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id  uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_no     integer NOT NULL,
  description varchar(200) NOT NULL,
  quantity    numeric(18,3) NOT NULL DEFAULT 1,
  uom         varchar(20),
  unit_price  numeric(18,4) NOT NULL DEFAULT 0,
  line_total  numeric(18,2) NOT NULL DEFAULT 0,
  is_vatable  boolean NOT NULL DEFAULT true,
  UNIQUE (invoice_id, line_no)
);

-- ============================================================================
-- Payments. A payment may settle several invoices, so allocations are a table.
-- ============================================================================
CREATE TABLE IF NOT EXISTS payments (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  customer_id    uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  payment_no     varchar(40) NOT NULL,
  payment_date   date NOT NULL DEFAULT CURRENT_DATE,
  method         varchar(30) NOT NULL DEFAULT 'bank_transfer'
                 CHECK (method IN ('cash', 'check', 'bank_transfer', 'online', 'card', 'other')),
  reference_no   varchar(80),
  amount         numeric(18,2) NOT NULL CHECK (amount > 0),
  currency       varchar(3) NOT NULL DEFAULT 'PHP',
  -- Customers can declare a payment; finance confirms it.
  status         varchar(20) NOT NULL DEFAULT 'confirmed'
                 CHECK (status IN ('declared', 'confirmed', 'rejected', 'void')),
  proof_url      text,
  notes          text,
  recorded_by    uuid REFERENCES users(id),
  confirmed_by   uuid REFERENCES users(id),
  confirmed_at   timestamptz,
  erp_ref        text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, payment_no)
);
SELECT attach_updated_at('payments');

CREATE INDEX IF NOT EXISTS idx_payments_customer
  ON payments (customer_id, payment_date DESC);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id   uuid NOT NULL REFERENCES payments(id)  ON DELETE CASCADE,
  invoice_id   uuid NOT NULL REFERENCES invoices(id)  ON DELETE CASCADE,
  amount       numeric(18,2) NOT NULL CHECK (amount > 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_alloc_invoice ON payment_allocations (invoice_id);

-- Recompute an invoice's paid amount and status from its confirmed allocations.
CREATE OR REPLACE FUNCTION recalc_invoice_payment(p_invoice_id uuid)
RETURNS void AS $$
DECLARE
  v_paid  numeric(18,2);
  v_total numeric(18,2);
BEGIN
  SELECT COALESCE(SUM(pa.amount), 0) INTO v_paid
    FROM payment_allocations pa
    JOIN payments p ON p.id = pa.payment_id
   WHERE pa.invoice_id = p_invoice_id
     AND p.status = 'confirmed';

  SELECT total_amount INTO v_total FROM invoices WHERE id = p_invoice_id;

  UPDATE invoices
     SET amount_paid = v_paid,
         status = CASE
           WHEN status IN ('void', 'draft') THEN status
           WHEN v_paid >= v_total AND v_total > 0 THEN 'paid'
           WHEN v_paid > 0 THEN 'partially_paid'
           ELSE 'open'
         END
   WHERE id = p_invoice_id;
END;
$$ LANGUAGE plpgsql;

-- Keep invoices in step whenever an allocation changes.
CREATE OR REPLACE FUNCTION trg_recalc_invoice_payment() RETURNS trigger AS $$
BEGIN
  PERFORM recalc_invoice_payment(COALESCE(NEW.invoice_id, OLD.invoice_id));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payment_allocations_recalc') THEN
    CREATE TRIGGER payment_allocations_recalc
      AFTER INSERT OR UPDATE OR DELETE ON payment_allocations
      FOR EACH ROW EXECUTE FUNCTION trg_recalc_invoice_payment();
  END IF;
END$$;

-- ============================================================================
-- Statement views
-- ============================================================================

-- Open items with ageing buckets, one row per unpaid invoice.
CREATE OR REPLACE VIEW customer_open_items AS
SELECT
  i.id            AS invoice_id,
  i.company_id,
  i.customer_id,
  i.invoice_no,
  i.invoice_date,
  i.due_date,
  i.total_amount,
  i.amount_paid,
  i.balance_due,
  i.currency,
  i.status,
  GREATEST(0, (CURRENT_DATE - i.due_date))::integer AS days_overdue,
  CASE
    WHEN CURRENT_DATE <= i.due_date                 THEN 'current'
    WHEN CURRENT_DATE - i.due_date BETWEEN 1  AND 30 THEN '1-30'
    WHEN CURRENT_DATE - i.due_date BETWEEN 31 AND 60 THEN '31-60'
    WHEN CURRENT_DATE - i.due_date BETWEEN 61 AND 90 THEN '61-90'
    ELSE '90+'
  END AS ageing_bucket
FROM invoices i
WHERE i.status IN ('open', 'partially_paid')
  AND i.balance_due > 0;

-- One row per customer: total exposure and ageing.
CREATE OR REPLACE VIEW customer_balances AS
SELECT
  c.id          AS customer_id,
  c.company_id,
  c.code,
  c.name,
  c.credit_limit,
  COALESCE(SUM(oi.balance_due), 0) AS total_outstanding,
  COALESCE(SUM(oi.balance_due) FILTER (WHERE oi.ageing_bucket = 'current'), 0) AS current_amount,
  COALESCE(SUM(oi.balance_due) FILTER (WHERE oi.ageing_bucket = '1-30'),   0) AS overdue_1_30,
  COALESCE(SUM(oi.balance_due) FILTER (WHERE oi.ageing_bucket = '31-60'),  0) AS overdue_31_60,
  COALESCE(SUM(oi.balance_due) FILTER (WHERE oi.ageing_bucket = '61-90'),  0) AS overdue_61_90,
  COALESCE(SUM(oi.balance_due) FILTER (WHERE oi.ageing_bucket = '90+'),    0) AS overdue_90_plus,
  c.credit_limit - COALESCE(SUM(oi.balance_due), 0) AS available_credit
FROM customers c
LEFT JOIN customer_open_items oi ON oi.customer_id = c.id
GROUP BY c.id, c.company_id, c.code, c.name, c.credit_limit;

-- ============================================================================
-- Notifications & audit
-- ============================================================================
CREATE TABLE IF NOT EXISTS notifications (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       varchar(200) NOT NULL,
  body        text,
  category    varchar(30) NOT NULL DEFAULT 'general'
              CHECK (category IN ('general', 'application', 'order', 'invoice', 'account')),
  link_url    text,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_log (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_email citext,
  action      varchar(60) NOT NULL,
  entity      varchar(60) NOT NULL,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  ip_address  inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log (entity, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor  ON audit_log (actor_id, created_at DESC);
