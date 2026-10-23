-- 1259 · Agent Skills standard (agentskills.io) — a skill is a FOLDER, not a text field.
--
-- WHY. Both skill stores held one Markdown body and nothing else: `tenant_skills.body`
-- (a workspace's own skills) and `marketplace_skills.readme` (the public catalogue). The
-- Agent Skills spec every agent tool now reads describes a skill as a directory — a
-- SKILL.md whose frontmatter carries `name`, `description` and four optional fields,
-- plus `scripts/`, `references/` and `assets/` the instructions load on demand. A skill
-- folder imported here lost everything but its body, and nothing exported back out.
--
-- TWO ADDITIONS, ONE PER FACT:
--   • `manifest` — the optional spec frontmatter (`license`, `compatibility`,
--     `metadata`, `allowed-tools`, and any non-spec keys verbatim) on each store's row.
--     `name` and `description` already have columns (the spec name IS the row's slug),
--     so they are not repeated here.
--   • `skill_files` — one row per bundled file, owned by exactly ONE skill of either
--     store. A file belongs to a skill and to nothing else, so it cascades with it; the
--     CHECK makes "exactly one owner" a property of the row, not of every writer.
--     A new kind of skill owner is a new nullable FK + a widened CHECK, never a third
--     copy of this table.

ALTER TABLE tenant_skills ADD COLUMN IF NOT EXISTS manifest JSONB;
ALTER TABLE marketplace_skills ADD COLUMN IF NOT EXISTS manifest JSONB;

COMMENT ON COLUMN tenant_skills.manifest IS 'Optional Agent Skills frontmatter: { license?, compatibility?, metadata?, allowedTools?, extensions }. name = slug, description = description.';
COMMENT ON COLUMN marketplace_skills.manifest IS 'Optional Agent Skills frontmatter: { license?, compatibility?, metadata?, allowedTools?, extensions }. name = slug, description = description, body = readme.';

CREATE TABLE IF NOT EXISTS skill_files (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_skill_id      UUID REFERENCES tenant_skills(id) ON DELETE CASCADE,
  marketplace_skill_id INTEGER REFERENCES marketplace_skills(id) ON DELETE CASCADE,
  -- Relative to the skill folder, POSIX-separated, never climbing out (validated by
  -- @builderforce/agent-skills before any write).
  path                 VARCHAR(512) NOT NULL,
  content              TEXT NOT NULL,
  size_bytes           INTEGER NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT skill_files_one_owner CHECK ((tenant_skill_id IS NULL) <> (marketplace_skill_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_skill_files_tenant_path
  ON skill_files(tenant_skill_id, path) WHERE tenant_skill_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_skill_files_marketplace_path
  ON skill_files(marketplace_skill_id, path) WHERE marketplace_skill_id IS NOT NULL;

COMMENT ON TABLE skill_files IS 'Bundled files of an Agent Skills folder (scripts/, references/, assets/). Exactly one owner: a tenant skill or a marketplace skill.';
