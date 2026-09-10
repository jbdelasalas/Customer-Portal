-- 007_signatures_captures.sql — e-signatures and camera captures.
--
-- A signature is only worth as much as the evidence around it. If a customer
-- later disputes an order, "they ticked a box" is weak; "they drew this
-- signature at this time, from this IP, on this device, against this exact
-- wording, and the record has not changed since" is defensible. So each
-- signature stores the image, the declaration text as shown, and the request
-- context — and a hash over all of it, so tampering is detectable.

-- ============================================================================
-- Signatures
-- ============================================================================
CREATE TABLE IF NOT EXISTS application_signatures (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id  uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,

  -- Which signature this is. A form may ask for more than one (applicant,
  -- witness, a co-signing officer).
  signature_key   varchar(60) NOT NULL DEFAULT 'applicant',

  -- Who is signing, as typed. Kept separate from the drawn image so the
  -- reviewer can compare the two.
  signatory_name     varchar(160) NOT NULL,
  signatory_position varchar(120),

  -- The drawn signature. PNG data URI for small strokes, or a storage path
  -- once it exceeds what is sensible to inline.
  signature_data  text,
  storage_path    text,
  CONSTRAINT signature_has_image CHECK (signature_data IS NOT NULL OR storage_path IS NOT NULL),

  -- 'drawn' = finger/stylus/mouse; 'typed' = accepted a rendered name.
  method          varchar(20) NOT NULL DEFAULT 'drawn'
                  CHECK (method IN ('drawn', 'typed')),

  -- The EXACT declaration text agreed to. Wording changes over time; without
  -- this we could not say what a past signatory actually consented to.
  declaration_text text NOT NULL,

  -- Evidence of the signing act.
  signed_at       timestamptz NOT NULL DEFAULT now(),
  ip_address      inet,
  user_agent      text,
  signed_by       uuid REFERENCES users(id),

  -- sha256 over the image + declaration + name + timestamp. Recomputable, so
  -- any later edit to those columns is detectable.
  evidence_hash   varchar(64) NOT NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (application_id, signature_key)
);

CREATE INDEX IF NOT EXISTS idx_application_signatures
  ON application_signatures (application_id);

-- ============================================================================
-- Camera captures — selfie and business premises
--
-- These extend application_documents rather than replacing it: same storage,
-- same review flow. The extra columns record what a plain upload cannot —
-- whether the image came from a live camera or the file system, and where the
-- device said it was.
-- ============================================================================
ALTER TABLE application_documents
  ADD COLUMN IF NOT EXISTS capture_source varchar(20)
    CHECK (capture_source IN ('camera', 'upload')),
  ADD COLUMN IF NOT EXISTS captured_at    timestamptz,
  ADD COLUMN IF NOT EXISTS latitude       numeric(10, 7),
  ADD COLUMN IF NOT EXISTS longitude      numeric(10, 7),
  ADD COLUMN IF NOT EXISTS location_accuracy_m numeric(10, 2),
  -- Free-form notes from the capture UI (device, facing mode, etc).
  ADD COLUMN IF NOT EXISTS capture_meta   jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_application_documents_captures
  ON application_documents (application_id, capture_source)
  WHERE capture_source = 'camera';

-- ============================================================================
-- Reviewers need to see signature and capture activity in the trail
-- ============================================================================
DO $$
BEGIN
  -- The event_type check constraint predates these events; widen it.
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'application_events_event_type_check'
  ) THEN
    ALTER TABLE application_events DROP CONSTRAINT application_events_event_type_check;
  END IF;

  ALTER TABLE application_events
    ADD CONSTRAINT application_events_event_type_check
    CHECK (event_type IN ('created', 'saved', 'submitted', 'assigned',
                          'commented', 'info_requested', 'info_provided',
                          'approved', 'rejected', 'withdrawn',
                          'document_uploaded', 'signed', 'photo_captured'));
END$$;
