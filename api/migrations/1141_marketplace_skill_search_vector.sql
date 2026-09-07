-- 1141 — `marketplace_skills.search_vector` never existed.
--
-- The column was declared in schema.ts (`tsvector('search_vector')`) and queried by
-- BOTH catalogue search surfaces — `GET /api/marketplace/skills?q=` and the public
-- `GET /api/v1/skills?q=` — and no migration ever created it, so every keyword search
-- on the marketplace failed outright with `column "search_vector" does not exist`.
-- Browsing without a query was unaffected, which is why it went unnoticed.
--
-- It survived the schema-drift guard because that guard's parser recognised only
-- Drizzle's built-in column builders; `tsvector` and `vector` are named `customType`
-- helpers, so every column declared with one was INVISIBLE to it. The parser now
-- discovers those names from the source (scripts/lib/drizzleSchema.mjs), which is how
-- this was found.
--
-- GENERATED, not trigger-maintained: the vector is derived from the row, so there is
-- no second writer that can forget to update it and no way for it to drift from the
-- text it indexes. `english` matches the configuration `skillSearch.ts` names on the
-- query side — a mismatch there makes the index unusable and the match wrong, both
-- silently.
ALTER TABLE marketplace_skills
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'english',
      coalesce(name, '') || ' '
        || coalesce(description, '') || ' '
        || coalesce(category, '') || ' '
        || coalesce(tags, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS marketplace_skills_search_vector_idx
  ON marketplace_skills USING GIN (search_vector);

COMMENT ON COLUMN marketplace_skills.search_vector IS 'Generated full-text index over name/description/category/tags. Queried by both catalogue search surfaces through application/marketplace/skillSearch.ts, which pins the same english configuration.';
