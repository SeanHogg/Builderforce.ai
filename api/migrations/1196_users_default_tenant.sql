-- 1196 · `users.default_tenant_id` — the workspace a person opens automatically.
--
-- "Set as default" on /tenants used to write only the browser's localStorage, and
-- `clearSession()` deleted that key on every sign-out AND every expired session —
-- exactly the moment the default is needed to skip the picker. It never left the
-- browser either, so a second device always asked. The choice is a fact about the
-- account, so it lives on the account.
--
-- ON DELETE SET NULL: a deleted workspace stops being anyone's default. Leaving a
-- workspace is handled at read time (the default only applies while the person is
-- still a member), so no membership trigger is needed.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS default_tenant_id integer REFERENCES tenants(id) ON DELETE SET NULL;
