-- 0278: track whether a user EXPLICITLY chose their account type (Build vs Hired).
--
-- Password registration always makes the choice on the /register form, but an
-- OAuth / magic-link account is auto-provisioned as 'standard' without ever being
-- asked. This nullable timestamp lets the onboarding gate force a one-time role
-- choice for those accounts: NULL = never chose (prompt), set = chose (skip).
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type_selected_at timestamp;

-- Grandfather every existing account so no current user is re-prompted; only
-- brand-new OAuth/magic-link signups going forward start with NULL.
UPDATE users SET account_type_selected_at = now() WHERE account_type_selected_at IS NULL;
