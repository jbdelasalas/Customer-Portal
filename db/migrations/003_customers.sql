-- 003_customers.sql — the customer master, created only when an application
-- is approved. Applications live in 004; this is the durable record.

CREATE TABLE IF NOT EXISTS customers (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,

  -- Human-facing account code, assigned on approval (see next_customer_code).
  code               varchar(30) NOT NULL,
  name               varchar(200) NOT NULL,
  legal_name         varchar(200),
  trade_name         varchar(200),

  customer_type      varchar(30) NOT NULL DEFAULT 'corporate'
                     CHECK (customer_type IN ('corporate', 'sole_proprietor', 'partnership', 'cooperative', 'government', 'individual')),
  business_type      varchar(120),

  -- Tax / registration
  tin                varchar(20),
  vat_status         varchar(20) DEFAULT 'vat'
                     CHECK (vat_status IN ('vat', 'non_vat', 'exempt', 'zero_rated')),
  business_permit_no varchar(60),
  sec_dti_reg_no     varchar(60),
  bir_cor_no         varchar(60),

  -- Primary contact
  contact_person     varchar(160),
  contact_position   varchar(120),
  email              citext,
  phone              varchar(40),
  mobile             varchar(40),

  -- Addresses
  billing_address    text,
  shipping_address   text,
  city               varchar(120),
  province           varchar(120),
  postal_code        varchar(20),
  country            varchar(80) DEFAULT 'Philippines',

  -- Commercial terms
  payment_terms_days integer NOT NULL DEFAULT 0,
  credit_limit       numeric(18,2) NOT NULL DEFAULT 0,
  price_tier         varchar(40),
  currency           varchar(3) NOT NULL DEFAULT 'PHP',

  status             varchar(20) NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'on_hold', 'suspended', 'closed')),
  hold_reason        text,

  -- Provenance: which application produced this customer (set in 004).
  application_id     uuid,
  -- Set when this customer has been pushed to / matched with the ERP.
  erp_ref            text,
  erp_synced_at      timestamptz,

  notes              text,
  created_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  UNIQUE (company_id, code)
);
SELECT attach_updated_at('customers');

CREATE INDEX IF NOT EXISTS idx_customers_company ON customers (company_id, status);
CREATE INDEX IF NOT EXISTS idx_customers_name    ON customers (company_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_customers_tin     ON customers (tin) WHERE tin IS NOT NULL;

-- Now that customers exists, close the users.customer_id loop.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_customer_id_fkey'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_customer_id_fkey
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
  END IF;
END$$;

-- ============================================================================
-- Additional contacts / delivery sites
-- ============================================================================
CREATE TABLE IF NOT EXISTS customer_contacts (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id  uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name         varchar(160) NOT NULL,
  position     varchar(120),
  email        citext,
  phone        varchar(40),
  role         varchar(40) DEFAULT 'general'
               CHECK (role IN ('general', 'billing', 'ordering', 'receiving', 'authorized_signatory')),
  is_primary   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
SELECT attach_updated_at('customer_contacts');

CREATE INDEX IF NOT EXISTS idx_customer_contacts ON customer_contacts (customer_id);

CREATE TABLE IF NOT EXISTS customer_sites (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id       uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name              varchar(160) NOT NULL,
  address           text NOT NULL,
  city              varchar(120),
  province          varchar(120),
  contact_person    varchar(160),
  phone             varchar(40),
  delivery_notes    text,
  latitude          numeric(10,7),
  longitude         numeric(10,7),
  is_default        boolean NOT NULL DEFAULT false,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
SELECT attach_updated_at('customer_sites');

CREATE INDEX IF NOT EXISTS idx_customer_sites ON customer_sites (customer_id) WHERE is_active;

-- Exactly one default site per customer.
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_default_site
  ON customer_sites (customer_id) WHERE is_default;

-- ============================================================================
-- Customer code sequence, per company. Format: <COMPANY_CODE>-000123
-- ============================================================================
CREATE TABLE IF NOT EXISTS customer_code_seq (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  last_value integer NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION next_customer_code(p_company_id uuid)
RETURNS varchar AS $$
DECLARE
  v_next integer;
  v_code varchar(20);
BEGIN
  INSERT INTO customer_code_seq (company_id, last_value)
  VALUES (p_company_id, 1)
  ON CONFLICT (company_id) DO UPDATE
    SET last_value = customer_code_seq.last_value + 1
  RETURNING last_value INTO v_next;

  SELECT code INTO v_code FROM companies WHERE id = p_company_id;
  RETURN v_code || '-' || lpad(v_next::text, 6, '0');
END;
$$ LANGUAGE plpgsql;
