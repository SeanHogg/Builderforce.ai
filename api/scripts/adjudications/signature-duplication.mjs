/**
 * DUPLICATE-SHAPE VERDICTS — table pairs whose payload columns overlap above the
 * guard's threshold and are, on inspection, two different facts.
 *
 * `check-signature-duplication.mjs` compares columns, so it is measuring SHAPE
 * and is blind to meaning. Two tables can be (provider, encrypted_secret,
 * created_at) and be the same fact recorded twice, or be two children of two
 * different aggregates that happen to configure the same kind of thing. Only
 * reading them answers that.
 *
 * These arguments used to live as `#` comments in the baseline file, where the
 * next `--update` would have deleted them without any diff a reviewer would read
 * as a deletion. They are data now; see `scripts/lib/adjudications.mjs`.
 *
 * The test: can ONE table hold both populations without a column that carries an
 * invariant becoming nullable, or a foreign key becoming a discriminator string?
 * A cluster that fails the test is duplication and stays in the baseline as work.
 */
export default {
  'error_collector_integrations = feedback_collector_integrations':
    'the two rows are children of DIFFERENT aggregates: one hangs off `error_collectors`, ' +
      'the other off `feedback_collectors`, and each cascades with its own parent. Folding ' +
      'them into one table means `collector_id` must point at two parents, which is either ' +
      'a polymorphic FK (forbidden by check-polymorphic-fk) or a pair of nullable FKs ' +
      'guarded by a CHECK — trading an enforced parent relationship for one the database ' +
      'can no longer enforce. The shape overlap is real but shallow: `provider` plus an ' +
      'encrypted secret is what ANY signed-webhook configuration looks like. The behaviour ' +
      'that matters is NOT duplicated — verification and normalisation live in one adapter ' +
      'registry per pillar and share `infrastructure/crypto/webhookHmac`.',

  'extension_categories = stage_lookup':
    'both are global vocabularies, so both are (key, label, description, position) — which ' +
      'is the SHAPE every lookup table has, and all the overlap is measuring. Neither can ' +
      'hold the other. `stage_lookup` is the platform-wide company-stage vocabulary a tenant ' +
      'selects FROM, the shared axis that makes two tenants’ Series A the same thing; its ' +
      '`category` column subdivides KINDS OF STAGE and is not a free slot for unrelated ' +
      'vocabularies. They differ where it counts — in IDENTITY. `extension_categories.key` ' +
      'is the PRIMARY KEY, so a category is referenceable by name; `stage_lookup` is a serial ' +
      'id unique on (category, key), so its rows are identified only inside a namespace. ' +
      '`extension_categories.active` also lets a chip be RETIRED without deleting a row, a ' +
      'lifecycle `stage_lookup` has no column for. The real consolidation, if one is ever ' +
      'wanted, is a properly named shared-vocabulary primitive both become rows of — not ' +
      'moving one into a table named after the other.',
  'marketing_tool_runs = tool_runs':
    'the columns match because a saved tool result is a saved tool result; the POPULATIONS cannot share a table. `tool_runs.tenant_id` is NOT NULL and the row is additionally scoped by project and task, because a diagnostic run inside a workspace is scored and rolls up into that project\'s rating. `marketing_tool_runs` has no tenant at all -- it is keyed by an anonymous `visitor_id`, written before any account exists. Merging means making `tenant_id` nullable on tenant-owned data, which takes the table out of `check-tenant-scope`\'s reach by construction and converts a structural guarantee into a convention. The lifecycles differ too: the tenant table APPENDS one row per run, the visitor table UPSERTS one row per (visitor, tool) so a returning visitor sees their last result. One table cannot both append and upsert on the same key.',

  'platform_modules = tenant_custom_roles':
    'the same shape at two tiers, and the tiers are the point: `platform_modules` is the platform-wide permission vocabulary with `is_builtin` and NO tenant column, and `tenant_custom_roles` is what a workspace COMPOSES from it, with a NOT NULL `created_by` and a `base_role` it extends. Merging requires a nullable tenant on customer data -- the same objection as the tool-runs cluster -- and it would let a workspace edit a row every other workspace reads, in a table whose builtin rows are the fixed floor a plan\'s entitlements are defined against.',

  'board_type_mappings = import_type_mappings':
    'two different PARENTS, and the mapping outlives one of them. `import_type_mappings.run_id` hangs off a migration run and dies with it; `board_type_mappings.connection_id` hangs off a live board connection and is consulted by SyncEngine on every inbound ticket, for as long as the board is connected. The board mapping is SEEDED from the import mapping and then diverges -- an operator retunes an ongoing sync without editing a finished import\'s record of what it did. Folding them together means one parent column pointing at two tables, which is a polymorphic foreign key (forbidden by `check-polymorphic-fk`) or a pair of nullable ones guarded by a CHECK: an enforced parent traded for one the database cannot enforce. Same argument as the collector-integrations cluster.',

  'kanban_template_lane_requirements = swimlane_requirements':
    'TEMPLATE versus INSTANCE, which the docstrings already state: the swimlane row is \'materialised onto a board\'s swimlanes when a template is applied (and directly editable)\'. That editability is the whole difference -- a live board\'s requirements are tuned per board and must keep working when the template they came from is changed or deleted, which is why the copy exists rather than a pointer. The parents differ accordingly (`lane_id` into a shared template, `swimlane_id` into one board\'s lane), so this is the same two-parents objection as the type-mappings cluster, plus a tenancy one: the template table has no tenant column and inherits through the template, while the swimlane table carries `tenant_id` NOT NULL because a live board\'s gating rules are read by the audit engine on the ticket path.',

  'project_manager_configs = tenant_manager_defaults':
    'the column NAMES match and their MEANINGS are opposite, which is the one case where merging on a shared signature destroys information. At the project tier each column is a VALUE; at the workspace tier the same name is a BOUND on that value, and the fold in `managerPolicy.ts` reads them differently on purpose. `enabled` is NOT NULL DEFAULT true on a project (a master switch) and a nullable KILL-SWITCH on the workspace, whose own docstring records why: project rows default to true, so last-tier-wins would let every existing row silently defeat the workspace switch. `allow_auto_merge`, `allow_unattended_ceremonies`, `allow_agent_reassignment` and `allow_auto_staff_lanes` are CEILINGS at the workspace tier and plain overrides at the project tier. `agent_reassign_idle_hours` and `agent_reassign_max_per_session` are folded MOST-RESTRICTIVE-WINS from the workspace (largest idle, smallest cap) and taken at face value from the project. `require_signoff_to_complete` is a workspace FLOOR and a project DECISION -- NOT NULL there specifically so the project states it outright instead of deferring. One table cannot hold a value and a bound on that value in one column; disambiguating by whether `project_id` is null is exactly the ambiguity that makes a merged settings table go wrong. The two rows are also different nouns beyond the policy: the project row NAMES the manager (`manager_ref`, `manager_type`) and carries the sweep\'s own runtime state (`last_run_at`, `last_sweep_decision`, `last_sweep_reason`, `last_sweep_at`), six columns that can never be non-null on a workspace row.',

};
