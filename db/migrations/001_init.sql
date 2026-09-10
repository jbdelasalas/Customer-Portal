-- 001_init.sql — extensions, shared helpers, and the tenant/company root.
-- All migrations in this project are ADDITIVE and IDEMPOTENT: safe to re-run.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- Keeps updated_at honest without every caller remembering to set it.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attaches the updated_at trigger to a table, only once.
CREATE OR REPLACE FUNCTION attach_updated_at(tbl regclass) RETURNS void AS $$
DECLARE
  trg_name text := 'set_updated_at_' || replace(tbl::text, '.', '_');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = trg_name) THEN
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      trg_name, tbl::text
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Companies — the selling entity a customer is onboarded to.
-- The portal is multi-company from day one because the ERP already is.
-- ============================================================================
CREATE TABLE IF NOT EXISTS companies (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  code         varchar(20)  NOT NULL UNIQUE,
  name         varchar(200) NOT NULL,
  legal_name   varchar(200),
  tin          varchar(20),
  address      text,
  phone        varchar(40),
  email        citext,
  logo_url     text,
  is_active    boolean NOT NULL DEFAULT true,
  -- Set when this company maps to a company row in the ERP. Nullable by
  -- design: the portal must work with no ERP connection at all.
  erp_ref      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
SELECT attach_updated_at('companies');

CREATE INDEX IF NOT EXISTS idx_companies_active ON companies (is_active) WHERE is_active;
