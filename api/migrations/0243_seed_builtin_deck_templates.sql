-- 0243_seed_builtin_deck_templates.sql
-- Seed the two built-in GENERATIVE deck templates (tenant_id=0): the R&D board
-- deck (the 6-slide Jellyfish-style board deck) and the CFO/DevFinOps deck. Both
-- are GENERATIVE — rendered from our branded pptxgenjs layout (GenerativeRenderer)
-- with NO uploaded binary — so they work with zero R2 seeding. The DeckService
-- resolves the layout by archetype; the manifest documents the binding tokens
-- the layout fills (and is also the token vocabulary a user can put in a custom
-- uploaded .pptx for in-place fill).
--
-- Fixed UUIDs so the seed is idempotent (ON CONFLICT DO NOTHING) and the frontend
-- can deep-link a built-in. Re-runnable.
--
-- Built-ins live at the sentinel tenant_id=0 (BUILTIN_TENANT in
-- TemplateLibraryService) — a GLOBAL row owned by no tenant. The original
-- 0242 table declared `tenant_id ... REFERENCES tenants(id)`, but tenants.id is
-- a serial starting at 1, so id 0 never exists and this seed violated
-- deck_templates_tenant_id_fkey ("Key (tenant_id)=(0) is not present in table
-- tenants"), aborting db:migrate and blocking EVERY API deploy. The FK is
-- incompatible with the 0-sentinel by design (the column even DEFAULTs to 0), so
-- we drop it here — the tenant scoping is enforced in the query layer, and no
-- tenant hard-delete path exists that relied on the cascade. Runs in the same
-- transaction as the seed, before the INSERT.
ALTER TABLE deck_templates DROP CONSTRAINT IF EXISTS deck_templates_tenant_id_fkey;

INSERT INTO deck_templates (id, tenant_id, name, description, archetype, is_builtin, manifest_json)
VALUES
  (
    '00000000-0000-4000-8000-000000000b01',
    0,
    'R&D Quarterly Board Deck',
    'The 6-slide R&D board deck for board meetings: Investment, Deliverables, Quality, Delivery & Operations, People, and AI Impact — populated from your workspace data.',
    'board',
    TRUE,
    '{"version":1,"bindings":[
      {"token":"quarter","bindingKey":"meta.quarter","kind":"text"},
      {"token":"rd_to_revenue","bindingKey":"investment.rdToRevenuePct","kind":"text","format":"percent"},
      {"token":"growth_rd","bindingKey":"investment.growthRdPct","kind":"text","format":"percent"},
      {"token":"deploy_freq","bindingKey":"delivery.deploymentFrequencyPerDay","kind":"text","format":"number"},
      {"token":"lead_time","bindingKey":"delivery.leadTimeHours","kind":"text","format":"number"},
      {"token":"change_failure","bindingKey":"delivery.changeFailureRatePct","kind":"text","format":"percent"},
      {"token":"prs_merged","bindingKey":"delivery.totalPrsMerged","kind":"text","format":"number"},
      {"token":"uptime","bindingKey":"quality.uptimePct","kind":"text","format":"percent"},
      {"token":"mttr","bindingKey":"quality.mttrHours","kind":"text","format":"number"},
      {"token":"support_tix","bindingKey":"quality.supportTickets","kind":"text","format":"number"},
      {"token":"attrition","bindingKey":"people.attritionRatePct","kind":"text","format":"percent"},
      {"token":"dev_satisfaction","bindingKey":"people.devSatisfactionScore","kind":"text","format":"number"},
      {"token":"ai_productivity","bindingKey":"ai.productivityScore","kind":"text","format":"number"},
      {"token":"table:deliverables","bindingKey":"deliverables.rows","kind":"table"},
      {"token":"table:initiatives","bindingKey":"investment.initiatives","kind":"table"},
      {"token":"table:openPositions","bindingKey":"people.openPositions","kind":"table"}
    ]}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000b02',
    0,
    'CFO / DevFinOps Deck',
    'A finance-lens deck for the CFO and DevFinOps: R&D spend by category, actual vs plan, cost-per-merged-PR, AI program investment and forecast — from your FinOps data.',
    'cfo_devfinops',
    TRUE,
    '{"version":1,"bindings":[
      {"token":"quarter","bindingKey":"meta.quarter","kind":"text"},
      {"token":"rd_to_revenue","bindingKey":"investment.rdToRevenuePct","kind":"text","format":"percent"},
      {"token":"total_actual","bindingKey":"investment.totalActualUsd","kind":"text","format":"currency"},
      {"token":"total_plan","bindingKey":"investment.totalPlanUsd","kind":"text","format":"currency"},
      {"token":"cost_per_pr","bindingKey":"finance.costPerMergedPrUsd","kind":"text","format":"currency"},
      {"token":"llm_spend","bindingKey":"finance.spendUsd","kind":"text","format":"currency"},
      {"token":"ai_invested","bindingKey":"ai.programInvestedUsd","kind":"text","format":"currency"},
      {"token":"table:financials","bindingKey":"investment.financialsByCategory","kind":"table"},
      {"token":"table:aiPrograms","bindingKey":"ai.programs","kind":"table"}
    ]}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;
