-- 002_auth.sql — users, roles, permissions, sessions.
--
-- Two populations share one users table, separated by `user_type`:
--   'customer' — self-signed-up portal users, scoped to ONE customer
--   'staff'    — internal reviewers/approvers, scoped to companies
-- Keeping them in one table means one login path and one session model; the
-- `user_type` check plus customer_id scoping is what keeps them apart.

CREATE TABLE IF NOT EXISTS users (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  email             citext NOT NULL UNIQUE,
  password_hash     text   NOT NULL,
  full_name         varchar(160) NOT NULL,
  phone             varchar(40),
  user_type         varchar(10) NOT NULL CHECK (user_type IN ('customer', 'staff')),

  -- Customer users only: set once their application is approved.
  customer_id       uuid,

  is_active         boolean NOT NULL DEFAULT true,
  is_superadmin     boolean NOT NULL DEFAULT false,

  email_verified_at timestamptz,
  last_login_at     timestamptz,

  -- Throttling / lockout
  failed_logins     integer NOT NULL DEFAULT 0,
  locked_until      timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- A staff user must never carry a customer_id.
  CONSTRAINT users_customer_scope CHECK (
    user_type = 'customer' OR customer_id IS NULL
  )
);
SELECT attach_updated_at('users');

CREATE INDEX IF NOT EXISTS idx_users_customer ON users (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_type     ON users (user_type, is_active);

-- ============================================================================
-- Roles & permissions (staff side; customers get access via customer_id)
-- ============================================================================
CREATE TABLE IF NOT EXISTS roles (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  code        varchar(40) NOT NULL UNIQUE,
  name        varchar(120) NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS permissions (
  id      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  code    varchar(80) NOT NULL UNIQUE,
  module  varchar(40) NOT NULL,
  action  varchar(40) NOT NULL,
  name    varchar(160) NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       uuid NOT NULL REFERENCES roles(id)       ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- Staff may be limited to specific companies. No rows = all companies.
CREATE TABLE IF NOT EXISTS user_companies (
  user_id    uuid NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, company_id)
);

-- ============================================================================
-- Sessions — refresh tokens are stored hashed so a DB leak can't mint sessions
-- ============================================================================
CREATE TABLE IF NOT EXISTS sessions (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL UNIQUE,
  user_agent         text,
  ip_address         inet,
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id)
  WHERE revoked_at IS NULL;

-- ============================================================================
-- One-time tokens: email verification, password reset, staff invites
-- ============================================================================
CREATE TABLE IF NOT EXISTS auth_tokens (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     varchar(30) NOT NULL CHECK (purpose IN ('verify_email', 'reset_password', 'invite')),
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens (user_id, purpose)
  WHERE consumed_at IS NULL;

-- ============================================================================
-- Seed roles & permissions
-- ============================================================================
INSERT INTO roles (code, name, description) VALUES
  ('superadmin',    'Superadmin',         'Full access to everything'),
  ('portal_admin',  'Portal admin',       'Manage portal users, customers and settings'),
  ('onboarding',    'Onboarding officer', 'Review and approve new customer applications'),
  ('sales',         'Sales',              'Manage orders and customer pricing'),
  ('logistics',     'Logistics',          'Advance orders through the delivery workflow'),
  ('finance',       'Finance',            'Manage invoices, payments and statements'),
  ('viewer',        'Viewer',             'Read-only access')
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions (code, module, action, name) VALUES
  ('application.view',    'application', 'view',    'View customer applications'),
  ('application.review',  'application', 'review',  'Review and comment on applications'),
  ('application.approve', 'application', 'approve', 'Approve or reject applications'),
  ('form.manage',         'form',        'manage',  'Create and edit form definitions'),
  ('customer.view',       'customer',    'view',    'View customers'),
  ('customer.manage',     'customer',    'manage',  'Create and edit customers'),
  ('pricing.manage',      'pricing',     'manage',  'Manage per-customer contract pricing'),
  ('order.view',          'order',       'view',    'View orders'),
  ('order.approve',       'order',       'approve', 'Approve or reject orders'),
  ('order.fulfil',        'order',       'fulfil',  'Advance orders through delivery stages'),
  ('invoice.view',        'invoice',     'view',    'View invoices and statements'),
  ('invoice.manage',      'invoice',     'manage',  'Create invoices and record payments'),
  ('user.manage',         'user',        'manage',  'Manage portal and staff users'),
  ('settings.manage',     'settings',    'manage',  'Manage company and portal settings')
ON CONFLICT (code) DO NOTHING;

-- Superadmin gets everything, including permissions added by later migrations.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.code = 'superadmin'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = ANY (ARRAY[
  'application.view','application.review','application.approve','form.manage',
  'customer.view','customer.manage','pricing.manage','order.view','order.approve',
  'order.fulfil','invoice.view','invoice.manage','user.manage','settings.manage'
]) WHERE r.code = 'portal_admin'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = ANY (ARRAY[
  'application.view','application.review','application.approve','customer.view','customer.manage'
]) WHERE r.code = 'onboarding'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = ANY (ARRAY[
  'customer.view','pricing.manage','order.view','order.approve','application.view'
]) WHERE r.code = 'sales'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = ANY (ARRAY[
  'order.view','order.fulfil','customer.view'
]) WHERE r.code = 'logistics'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = ANY (ARRAY[
  'invoice.view','invoice.manage','customer.view','order.view'
]) WHERE r.code = 'finance'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = ANY (ARRAY[
  'application.view','customer.view','order.view','invoice.view'
]) WHERE r.code = 'viewer'
ON CONFLICT DO NOTHING;
