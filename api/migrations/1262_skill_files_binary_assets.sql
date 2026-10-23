-- 1262 · Binary skill assets — an Agent Skills folder keeps its images, fonts and PDFs.
--
-- WHY. 1259 stored a skill folder as text (`skill_files.content`), so a binary file
-- under `assets/` was reported "not included" on import and lost. Binary files now go to
-- R2 (the UPLOADS bucket) and the row records where: `encoding` says how the file
-- travels on the wire ('utf8' text inline in `content`, 'base64' bytes in R2 at
-- `r2_key`), and `size_bytes` stays the decoded size either way.
--
-- EXPAND-ONLY. Every existing row is text, so the default 'utf8' describes it exactly,
-- and the old Worker — which writes only text rows with `content` set — keeps satisfying
-- the CHECK through the deploy window. Nothing is dropped.

ALTER TABLE skill_files ADD COLUMN IF NOT EXISTS encoding VARCHAR(10) NOT NULL DEFAULT 'utf8';
ALTER TABLE skill_files ADD COLUMN IF NOT EXISTS r2_key TEXT;
ALTER TABLE skill_files ALTER COLUMN content DROP NOT NULL;

-- Where a file's bytes live is a property of the row, not of every writer: text inline,
-- binary in R2, never both and never neither.
ALTER TABLE skill_files DROP CONSTRAINT IF EXISTS skill_files_body_location;
ALTER TABLE skill_files ADD CONSTRAINT skill_files_body_location CHECK (
  (encoding = 'utf8'   AND content IS NOT NULL AND r2_key IS NULL) OR
  (encoding = 'base64' AND content IS NULL     AND r2_key IS NOT NULL)
);

COMMENT ON COLUMN skill_files.encoding IS 'utf8 = text in content; base64 = binary bytes in R2 (UPLOADS) at r2_key, served base64 on the wire.';
COMMENT ON COLUMN skill_files.r2_key IS 'UPLOADS key of a binary asset: skill-files/<tenantId|market>/<skillId>/<writeId>/<path>.';
