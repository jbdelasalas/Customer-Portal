-- 004_onboarding.sql — the new-customer application flow.
--
-- Forms are DATA, not code: a form_versions row holds a JSON schema of
-- sections and fields, and the UI renders whatever it finds there. When the
-- business changes the form we publish a new version; in-flight applications
-- keep rendering and validating against the version they started on.

-- ============================================================================
-- Form definitions
-- ============================================================================
CREATE TABLE IF NOT EXISTS forms (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  uuid REFERENCES companies(id) ON DELETE CASCADE,  -- null = global
  code        varchar(60) NOT NULL,
  name        varchar(200) NOT NULL,
  description text,
  kind        varchar(30) NOT NULL DEFAULT 'customer_application'
              CHECK (kind IN ('customer_application', 'credit_application', 'update_request', 'other')),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
SELECT attach_updated_at('forms');

-- One immutable row per published revision.
--
-- `schema` shape:
-- {
--   "sections": [
--     { "key": "business_info",
--       "title": "Business Information",
--       "description": "...",
--       "fields": [
--         { "key": "legal_name",
--           "label": "Registered business name",
--           "type": "text",            -- text|textarea|number|email|phone|date|
--                                      -- select|multiselect|radio|checkbox|
--                                      -- file|section_note|table
--           "required": true,
--           "placeholder": "...",
--           "help": "...",
--           "maxLength": 200,
--           "options": [{ "value": "vat", "label": "VAT registered" }],
--           "showIf": { "field": "customer_type", "equals": "corporate" },
--           "mapsTo": "customers.legal_name"   -- optional: auto-fill on approval
--         }
--       ]
--     }
--   ],
--   "documents": [
--     { "key": "sec_reg", "label": "SEC/DTI Registration", "required": true,
--       "accept": ["application/pdf","image/*"], "maxSizeMb": 10 }
--   ]
-- }
CREATE TABLE IF NOT EXISTS form_versions (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  form_id      uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  version      integer NOT NULL,
  schema       jsonb NOT NULL,
  changelog    text,
  status       varchar(20) NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft', 'published', 'retired')),
  published_at timestamptz,
  published_by uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (form_id, version)
);

CREATE INDEX IF NOT EXISTS idx_form_versions_published
  ON form_versions (form_id, version DESC) WHERE status = 'published';

-- ============================================================================
-- Applications — one per prospective customer submission
-- ============================================================================
CREATE TABLE IF NOT EXISTS applications (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  form_version_id  uuid NOT NULL REFERENCES form_versions(id) ON DELETE RESTRICT,

  reference_no     varchar(30) NOT NULL UNIQUE,

  -- The applicant's account. Null while the form is filled anonymously.
  applicant_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  applicant_email   citext NOT NULL,
  applicant_name    varchar(160),
  applicant_phone   varchar(40),

  -- Denormalised for the review queue, pulled from `data` on submit.
  business_name    varchar(200),

  -- The filled form. Keys match form_versions.schema field keys.
  data             jsonb NOT NULL DEFAULT '{}'::jsonb,

  status           varchar(20) NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'submitted', 'under_review',
                                     'info_requested', 'approved', 'rejected', 'withdrawn')),

  submitted_at     timestamptz,
  reviewed_by      uuid REFERENCES users(id),
  reviewed_at      timestamptz,
  decided_by       uuid REFERENCES users(id),
  decided_at       timestamptz,
  decision_notes   text,

  -- Set once approved.
  customer_id      uuid REFERENCES customers(id) ON DELETE SET NULL,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
SELECT attach_updated_at('applications');

CREATE INDEX IF NOT EXISTS idx_applications_queue
  ON applications (company_id, status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_applications_applicant
  ON applications (applicant_user_id) WHERE applicant_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_applications_email
  ON applications (applicant_email);

-- Close the loop from customers back to the application that created it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_application_id_fkey'
  ) THEN
    ALTER TABLE customers
      ADD CONSTRAINT customers_application_id_fkey
      FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL;
  END IF;
END$$;

-- ============================================================================
-- Uploaded documents
-- ============================================================================
CREATE TABLE IF NOT EXISTS application_documents (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  -- Matches a `documents[].key` in the form schema; free-form for extras.
  doc_key        varchar(60) NOT NULL,
  file_name      varchar(255) NOT NULL,
  content_type   varchar(120),
  size_bytes     bigint,
  storage_path   text NOT NULL,
  checksum_sha256 varchar(64),
  uploaded_by    uuid REFERENCES users(id),
  uploaded_at    timestamptz NOT NULL DEFAULT now(),

  status         varchar(20) NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'accepted', 'rejected')),
  reject_reason  text
);

CREATE INDEX IF NOT EXISTS idx_application_documents
  ON application_documents (application_id, doc_key);

-- ============================================================================
-- Review trail — every status change and comment, append-only
-- ============================================================================
CREATE TABLE IF NOT EXISTS application_events (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  event_type     varchar(30) NOT NULL
                 CHECK (event_type IN ('created', 'saved', 'submitted', 'assigned',
                                       'commented', 'info_requested', 'info_provided',
                                       'approved', 'rejected', 'withdrawn', 'document_uploaded')),
  from_status    varchar(20),
  to_status      varchar(20),
  message        text,
  -- Visible to the applicant in the portal? Internal notes stay false.
  is_public      boolean NOT NULL DEFAULT false,
  actor_user_id  uuid REFERENCES users(id),
  actor_label    varchar(160),
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_application_events
  ON application_events (application_id, created_at DESC);

-- ============================================================================
-- Reference numbers: APP-YYYY-000123, restarting each year
-- ============================================================================
CREATE TABLE IF NOT EXISTS application_ref_seq (
  year       integer PRIMARY KEY,
  last_value integer NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION next_application_ref()
RETURNS varchar AS $$
DECLARE
  v_year integer := EXTRACT(YEAR FROM now())::integer;
  v_next integer;
BEGIN
  INSERT INTO application_ref_seq (year, last_value)
  VALUES (v_year, 1)
  ON CONFLICT (year) DO UPDATE
    SET last_value = application_ref_seq.last_value + 1
  RETURNING last_value INTO v_next;

  RETURN 'APP-' || v_year::text || '-' || lpad(v_next::text, 6, '0');
END;
$$ LANGUAGE plpgsql;
