-- 1263 · Kanban templates and canvas (creation-session) templates move into `catalog_items`.
-- EXPAND step. The CONTRACT step (catch-up + drop of the legacy tables) is 1267.
--
-- DECIDED (operator, final): `catalog_items` is the platform's ONE catalogue /
-- marketplace store — workspace templates (kind 'template'), listings, packs, presets
-- and policy packs already live there. A kanban board template and a canvas template
-- are two more KINDS of the same row, not two more tables (3NF: a new kind is a column
-- VALUE). Every reader and writer now goes through
-- `application/templates/catalogTemplateStore.ts`.
--
--   kanban_templates (+ kanban_template_lanes + kanban_template_lane_requirements)
--     -> catalog_items kind = 'kanban_template'
--          id            kept when uuid-shaped (it always was: crypto.randomUUID());
--                        a non-uuid id gets a fresh uuid and the OLD id is recorded in
--                        body.legacyId, and every boards.template_id /
--                        projects.kanban_template_id and every other template's
--                        body.parentTemplateId that named it is re-pointed.
--          slug, name, category, visibility, price_cents, install_count, timestamps
--                        carried column-for-column; description -> summary.
--          published     -> published_at (= updated_at when published, else NULL).
--          author_id     -> created_by.
--          version (int) -> version (text, e.g. '3').
--          team_type, parent_template_id, pricing_model, price_unit and the lanes
--          (each with its requirements, both ordered by position) -> body (jsonb):
--          they are kanban-specific, so they are the kind's payload, not columns.
--          currency      'usd' when priced (the convention saveTemplate already uses).
--
--   creation_session_templates
--     -> catalog_items kind = 'canvas_template'
--          id, tenant_id, segment_id, name, category, visibility, timestamps as-is;
--          description -> summary; created_by -> created_by;
--          graph, marketplace_listing_id, updated_by -> body.
--          slug = 'canvas-' || id (unique by construction; a canvas template has no
--          human key).
--
-- `catalog_items` gains two columns any kind can carry, and a wider category:
--   segment_id  uuid        — segment scoping (canvas templates are per segment).
--   created_by  varchar(36) — the authoring user ("private" = visible to its author).
--   category    varchar(64) -> varchar(80), so a canvas category carries untruncated.
--
-- EXPAND / CONTRACT. The legacy tables are NOT dropped here: the Worker that is live
-- while this runs still reads and writes them. The backfill is ONE function,
-- `backfill_legacy_templates()`, so 1267 can re-run the same copy for whatever the old
-- Worker wrote during the deploy window before it drops the tables and the function.
--
-- DATA-PRESERVING: the function counts each source table against what landed and
-- RAISES (rolling the whole file back — scripts/migrate.mjs applies a file in one
-- transaction) if a row did not carry. Idempotent: every step is guarded on its
-- source table existing, and every copy is an upsert that refreshes a catalog row
-- only when its legacy source is strictly newer (the REFRESH RULE in the function).
-- DELETES in the window are carried too, by `templates_fold_ledger`: every copy this
-- function makes is recorded there (catalog id ← legacy table + id), so 1267 can tell
-- a copy whose legacy row the OLD Worker deleted (delete the copy) from a row the NEW
-- Worker created (never in the ledger — left alone), and a copy the NEW Worker deleted
-- (in the ledger, catalog row gone — the re-run never resurrects it). The ledger is
-- dropped by 1267 with the legacy tables.

-- ── 0. catalog_items: the generic columns ───────────────────────────────────────
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS segment_id UUID;
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS created_by VARCHAR(36);
ALTER TABLE catalog_items ALTER COLUMN category TYPE VARCHAR(80);

ALTER TABLE catalog_items DROP CONSTRAINT IF EXISTS fk_catalog_items_segment;
ALTER TABLE catalog_items ADD CONSTRAINT fk_catalog_items_segment
  FOREIGN KEY (segment_id) REFERENCES segments(id) ON DELETE CASCADE;
ALTER TABLE catalog_items DROP CONSTRAINT IF EXISTS fk_catalog_items_created_by;
ALTER TABLE catalog_items ADD CONSTRAINT fk_catalog_items_created_by
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

-- The tenant-owned list read (tenant, kind, newest first) and the segment-scoped
-- canvas-template read.
CREATE INDEX IF NOT EXISTS idx_catalog_items_tenant_kind
  ON catalog_items (tenant_id, kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_catalog_items_segment
  ON catalog_items (tenant_id, segment_id, kind) WHERE segment_id IS NOT NULL;

-- ── 1. The fold ledger ──────────────────────────────────────────────────────────
-- Which catalog_items row each legacy template became. No FK to catalog_items on
-- purpose: when the NEW Worker deletes a copy, its ledger row must SURVIVE, because
-- that is how the 1267 re-run knows not to resurrect it from the still-present
-- legacy row.
CREATE TABLE IF NOT EXISTS templates_fold_ledger (
  catalog_id   UUID PRIMARY KEY,
  legacy_table TEXT NOT NULL,
  legacy_id    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_templates_fold_ledger_legacy
  ON templates_fold_ledger (legacy_table, legacy_id);

-- ── 2. The backfill (the one copy; 1267 calls it again) ─────────────────────────
CREATE OR REPLACE FUNCTION backfill_legacy_templates() RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  source_count INTEGER;
  carried      INTEGER;
BEGIN
  -- REFRESH RULE (why every insert below is an upsert). 1263 runs this once; 1267
  -- runs it again after the deploy window, while the OLD Worker was still writing
  -- the legacy tables. A legacy row the old Worker edited in the window must refresh
  -- its copy, and a copy the NEW Worker edited must not be clobbered. Both legacy
  -- tables carry `updated_at`, and both Workers stamp it on every edit, so the
  -- rule is NEWEST WRITE WINS, per row: the copy is overwritten only when the legacy
  -- row's `updated_at` is strictly later than the copy's
  -- (`WHERE excluded.updated_at > catalog_items.updated_at`). A copy untouched since
  -- 1263 has exactly the legacy timestamp, so an unchanged row is a no-op.
  -- `install_count` is the exception: the old Worker counted installs without
  -- touching `updated_at`, and both Workers only ever increment, so it takes the
  -- GREATEST of the two on every refresh.

  -- ── kanban_templates -> catalog_items (kind 'kanban_template') ──
  IF to_regclass('public.kanban_templates') IS NOT NULL THEN
    INSERT INTO catalog_items (
      id, tenant_id, kind, slug, name, summary, body, category, tags, version,
      visibility, price_cents, currency, publisher_ref, install_count, is_template,
      published_at, created_by, created_at, updated_at
    )
    SELECT
      -- A legacy (non-uuid) row already copied on an earlier call reuses the uuid
      -- it was given (matched by its recorded legacyId), so a re-run refreshes that
      -- copy instead of minting a second one.
      CASE WHEN kt.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN kt.id::uuid
           ELSE COALESCE((SELECT done.id FROM catalog_items done
                           WHERE done.kind = 'kanban_template' AND done.body->>'legacyId' = kt.id
                           LIMIT 1),
                         gen_random_uuid()) END,
      kt.tenant_id,
      'kanban_template',
      kt.slug,
      kt.name,
      kt.description,
      jsonb_strip_nulls(jsonb_build_object(
        'teamType',         kt.team_type,
        'parentTemplateId', kt.parent_template_id,
        'pricingModel',     kt.pricing_model,
        'priceUnit',        kt.price_unit,
        'legacyId',         CASE WHEN kt.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                 THEN NULL ELSE kt.id END
      )) || jsonb_build_object('lanes', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'key',             l.key,
                 'name',            l.name,
                 'position',        l.position,
                 'isTerminal',      l.is_terminal,
                 'gate',            l.gate,
                 'requirementGate', l.requirement_gate,
                 'requirements',    COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'kind',           r.kind,
                            'ref',            r.ref,
                            'responsibility', r.responsibility,
                            'isRequired',     r.is_required,
                            'description',    r.description,
                            'position',       r.position,
                            'ticketType',     r.ticket_type,
                            'quorum',         r.quorum,
                            'condition',      r.condition
                          ) ORDER BY r.position, r.id)
                     FROM kanban_template_lane_requirements r
                    WHERE r.lane_id = l.id
                 ), '[]'::jsonb)
               ) ORDER BY l.position, l.id)
          FROM kanban_template_lanes l
         WHERE l.template_id = kt.id
      ), '[]'::jsonb)),
      kt.category,
      NULL,
      kt.version::text,
      kt.visibility,
      kt.price_cents,
      CASE WHEN kt.price_cents IS NOT NULL THEN 'usd' END,
      NULL,
      kt.install_count,
      true,
      CASE WHEN kt.published THEN kt.updated_at END,
      kt.author_id,
      kt.created_at,
      kt.updated_at
    FROM kanban_templates kt
    -- Never resurrect a copy the NEW Worker deleted: it is in the ledger, and its
    -- catalog row is gone.
    WHERE NOT EXISTS (
      SELECT 1 FROM templates_fold_ledger led
       WHERE led.legacy_table = 'kanban_templates' AND led.legacy_id = kt.id
         AND NOT EXISTS (SELECT 1 FROM catalog_items gone WHERE gone.id = led.catalog_id)
    )
    ON CONFLICT (id) DO UPDATE SET
      slug          = excluded.slug,
      name          = excluded.name,
      summary       = excluded.summary,
      body          = excluded.body,
      category      = excluded.category,
      version       = excluded.version,
      visibility    = excluded.visibility,
      price_cents   = excluded.price_cents,
      currency      = excluded.currency,
      install_count = GREATEST(catalog_items.install_count, excluded.install_count),
      published_at  = excluded.published_at,
      created_by    = excluded.created_by,
      updated_at    = excluded.updated_at
    WHERE catalog_items.kind = 'kanban_template'
      AND excluded.updated_at > catalog_items.updated_at;

    -- A non-uuid template id got a fresh uuid: re-point what named it. Boards and
    -- projects inside the template's tenant; fork lineage anywhere (a public
    -- template can be installed into another workspace, and the old id was unique).
    UPDATE boards b SET template_id = ci.id::text
      FROM catalog_items ci
     WHERE ci.kind = 'kanban_template'
       AND ci.body ? 'legacyId'
       AND ci.tenant_id = b.tenant_id
       AND b.template_id = ci.body->>'legacyId';
    UPDATE projects p SET kanban_template_id = ci.id::text
      FROM catalog_items ci
     WHERE ci.kind = 'kanban_template'
       AND ci.body ? 'legacyId'
       AND ci.tenant_id = p.tenant_id
       AND p.kanban_template_id = ci.body->>'legacyId';
    UPDATE catalog_items child
       SET body = jsonb_set(child.body, '{parentTemplateId}', to_jsonb(parent.id::text))
      FROM catalog_items parent
     WHERE child.kind = 'kanban_template'
       AND parent.kind = 'kanban_template'
       AND parent.body ? 'legacyId'
       AND child.body->>'parentTemplateId' = parent.body->>'legacyId';

    -- Record every copy (a re-run's refresh of an existing copy is already there).
    INSERT INTO templates_fold_ledger (catalog_id, legacy_table, legacy_id)
    SELECT ci.id, 'kanban_templates', kt.id
      FROM kanban_templates kt
      JOIN catalog_items ci
        ON ci.kind = 'kanban_template'
       AND ci.tenant_id = kt.tenant_id
       AND CASE WHEN kt.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN ci.id = kt.id::uuid
                ELSE ci.body->>'legacyId' = kt.id END
    ON CONFLICT DO NOTHING;

    -- Carried = has its copy, or its copy was deliberately deleted by the new Worker.
    SELECT count(*) INTO source_count FROM kanban_templates;
    SELECT count(*) INTO carried
      FROM kanban_templates kt
     WHERE EXISTS (
       SELECT 1 FROM templates_fold_ledger led
        WHERE led.legacy_table = 'kanban_templates' AND led.legacy_id = kt.id
     );
    IF carried <> source_count THEN
      RAISE EXCEPTION 'backfill_legacy_templates: only % of % kanban_templates rows reached catalog_items (a (tenant, kind, slug) collision?)', carried, source_count;
    END IF;
  END IF;

  -- ── creation_session_templates -> catalog_items (kind 'canvas_template') ──
  IF to_regclass('public.creation_session_templates') IS NOT NULL THEN
    INSERT INTO catalog_items (
      id, tenant_id, segment_id, kind, slug, name, summary, body, category, version,
      visibility, install_count, is_template, created_by, created_at, updated_at
    )
    SELECT
      t.id,
      t.tenant_id,
      t.segment_id,
      'canvas_template',
      'canvas-' || t.id::text,
      t.name,
      t.description,
      jsonb_strip_nulls(jsonb_build_object(
        'marketplaceListingId', t.marketplace_listing_id,
        'updatedBy',            t.updated_by
      )) || jsonb_build_object('graph', t.graph),
      t.category,
      '1.0.0',
      t.visibility,
      0,
      true,
      t.created_by,
      t.created_at,
      t.updated_at
    FROM creation_session_templates t
    WHERE NOT EXISTS (
      SELECT 1 FROM templates_fold_ledger led
       WHERE led.legacy_table = 'creation_session_templates' AND led.legacy_id = t.id::text
         AND NOT EXISTS (SELECT 1 FROM catalog_items gone WHERE gone.id = led.catalog_id)
    )
    ON CONFLICT (id) DO UPDATE SET
      segment_id = excluded.segment_id,
      name       = excluded.name,
      summary    = excluded.summary,
      body       = excluded.body,
      category   = excluded.category,
      visibility = excluded.visibility,
      created_by = excluded.created_by,
      updated_at = excluded.updated_at
    WHERE catalog_items.kind = 'canvas_template'
      AND excluded.updated_at > catalog_items.updated_at;

    INSERT INTO templates_fold_ledger (catalog_id, legacy_table, legacy_id)
    SELECT ci.id, 'creation_session_templates', t.id::text
      FROM creation_session_templates t
      JOIN catalog_items ci ON ci.id = t.id AND ci.kind = 'canvas_template'
    ON CONFLICT DO NOTHING;

    SELECT count(*) INTO source_count FROM creation_session_templates;
    SELECT count(*) INTO carried
      FROM creation_session_templates t
     WHERE EXISTS (
       SELECT 1 FROM templates_fold_ledger led
        WHERE led.legacy_table = 'creation_session_templates' AND led.legacy_id = t.id::text
     );
    IF carried <> source_count THEN
      RAISE EXCEPTION 'backfill_legacy_templates: only % of % creation_session_templates rows reached catalog_items', carried, source_count;
    END IF;
  END IF;
END
$fn$;

SELECT backfill_legacy_templates();
