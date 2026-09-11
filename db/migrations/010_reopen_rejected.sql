-- ============================================================================
-- Let an applicant reopen a rejected application and try again
-- ============================================================================
-- A rejection was terminal: the answers and every uploaded document were
-- stranded on a row nobody could edit, so a second attempt meant re-keying the
-- form and re-uploading eleven files. Reopening moves the same row back to
-- 'draft' instead, which keeps the reference number, the documents and the
-- review trail intact.
--
-- 'reopened' is the event recording that; the check constraint predates it.
DO $$
BEGIN
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
                          'document_uploaded', 'signed', 'photo_captured',
                          'reopened'));
END$$;

-- How many times this application has been sent back and revised. Drives the
-- "Attempt 2" label for reviewers, and makes a serial reapplier visible.
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS reopen_count integer NOT NULL DEFAULT 0;

-- The resume lookup filters by applicant and status; idx_applications_applicant
-- already covers it, and an applicant has too few applications for a more
-- specific index to earn its keep.
