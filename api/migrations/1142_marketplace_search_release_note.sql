-- 1142 · Release note for the marketplace-search fix (migration 1141).
--
-- `fix`, not `new`. Searching the catalogue by keyword was an advertised, linked,
-- shipped control that had never once worked — the column both search surfaces
-- queried was declared in the schema and created by no migration. Making something
-- work as claimed is not news.
--
-- Fixed id so the migration is safe to replay, `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (
  id,
  version,
  title,
  body,
  category,
  stage,
  published_at
) VALUES
  (
    'a1b2c301-0006-4000-8000-000000000007',
    '2026.9.14',
    'Searching the marketplace works',
    'Typing a query into the skill catalogue returned an error rather than results — on the marketplace and on the public API alike. Browsing and filtering by category were unaffected, which is why it looked like search simply found nothing. Keyword search now runs against a full-text index over each skill''s name, description, category and tags, so a phrase from a skill''s README finds it, and the index is derived from the skill itself rather than maintained alongside it — it cannot fall behind an edit.',
    'fix',
    'live',
    '2026-09-07 12:40:00'
  )
ON CONFLICT (id) DO NOTHING;
