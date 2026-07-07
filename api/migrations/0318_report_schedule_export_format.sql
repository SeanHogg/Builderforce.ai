-- 0318_report_schedule_export_format.sql
-- EMP-20 — Export formats on scheduled reports.
-- report_schedules (recurring emailed reports) gains a preferred export format so a
-- scheduled delivery can attach the same CSV / printable-HTML artifact the on-demand
-- Export menu produces. Additive + defaulted → existing schedules keep 'csv'.
-- Idempotent.

ALTER TABLE report_schedules ADD COLUMN IF NOT EXISTS export_format VARCHAR(8) NOT NULL DEFAULT 'csv'; -- csv | html
