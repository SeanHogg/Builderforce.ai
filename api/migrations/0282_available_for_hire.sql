-- 0282: let an EXISTING builder opt in to being hired talent.
--
-- Being for-hire was previously all-or-nothing: only a users.account_type =
-- 'freelancer' account (the restricted gig-only shell) could be found + hired.
-- A person who signed up to BUILD but also wants to pick up work had no path in
-- without abandoning their workspace.
--
-- This flag decouples "open to being hired" from the account type. A 'standard'
-- account can flip it on, keep its full builder shell, AND publish a for-hire
-- profile that appears in the talent marketplace. Discoverability itself stays
-- gated on a PUBLISHED profile (unchanged); this flag drives the opt-in UX, the
-- for-hire nav destinations, and the "can bid on gigs" gate.
ALTER TABLE users ADD COLUMN IF NOT EXISTS available_for_hire boolean NOT NULL DEFAULT false;

-- Existing freelancer accounts are inherently for-hire — backfill so their bid
-- gate and profile keep working; new freelancer signups set it at provision time.
UPDATE users SET available_for_hire = true WHERE account_type = 'freelancer' AND available_for_hire = false;
