-- IN-1 — a company can own the work being done inside it.
--
-- `projects` named no company, so the one-company-to-many-projects edge the
-- investor framing depends on did not exist: a fundraising pack could not
-- enumerate what is being built, a diligence answer could not cite the project
-- that produced it, and a portfolio view had nothing to roll delivery up to.
--
-- NULLABLE, and there is NO BACKFILL. The great majority of existing projects
-- predate any `companies` row, and the only signal available to match them on is
-- the name — which is exactly the string-matching defect FO-A1/FO-A2 exist to
-- remove. A project belongs to a company when somebody says so; a project whose
-- company is unknown reads as unknown rather than as a guess that looks like a
-- fact.
--
-- ON DELETE SET NULL, not CASCADE. Deleting the company record must never delete
-- the delivery history — the work happened whether or not the row that described
-- who it was for survives.
--
-- The FK is declared HERE and deliberately NOT on the Drizzle column. `projects`
-- lives in `schema/delivery.ts` and `companies` in `schema/investor.ts`; a
-- `.references(() => companies.id)` would open a new `delivery.ts -> investor.ts`
-- edge that `check-domain-boundary` counts, for a pointer that is enforced by the
-- database either way. Same call `data_room_shares.nda_signature_request_id` and
-- `legal_document_files.signature_request_id` already made, for the same reason.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS company_id integer
  REFERENCES companies(id) ON DELETE SET NULL;

-- The access path is "every project for this company", which is how the company
-- view lists its work and how the pack enumerates it. Partial, because the column
-- is null on every row that predates a company and indexing those buys nothing.
CREATE INDEX IF NOT EXISTS idx_projects_company
  ON projects (tenant_id, company_id)
  WHERE company_id IS NOT NULL;
