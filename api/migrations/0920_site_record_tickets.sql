-- W1E (R10): app-user loop — a submission to a `site_collections.raises_tickets`
-- collection opens a board ticket, and the ticket's Done transition notifies the
-- site_user back. Cross-domain by id: a plain column, no FK, same shape as
-- tasks.job_posting_id (0293) — the growth domain owns site_records, delivery
-- only references it by id.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS origin_site_record_id BIGINT;
CREATE INDEX IF NOT EXISTS idx_tasks_origin_site_record ON tasks(origin_site_record_id) WHERE origin_site_record_id IS NOT NULL;
