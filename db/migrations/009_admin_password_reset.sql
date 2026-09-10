-- 009_admin_password_reset.sql — let staff reset a customer's password.
--
-- Email delivery is not configured yet, so a customer who forgets their
-- password has no self-service route. This gives staff a way to issue a
-- temporary password over the phone, without ever choosing or seeing the
-- customer's real one.
--
-- `must_change_password` is what stops a temporary password becoming a
-- permanent one: the customer can sign in with it, but cannot go anywhere
-- until they set their own.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS password_changed_at  timestamptz,
  -- Who issued the last admin reset, so the audit trail survives even if the
  -- audit_log is pruned.
  ADD COLUMN IF NOT EXISTS password_reset_by    uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS password_reset_at    timestamptz;

CREATE INDEX IF NOT EXISTS idx_users_must_change
  ON users (id) WHERE must_change_password;

-- Existing accounts have chosen their own password already.
UPDATE users SET password_changed_at = created_at WHERE password_changed_at IS NULL;
