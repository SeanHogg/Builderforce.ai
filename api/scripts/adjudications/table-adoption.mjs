/**
 * TABLE-ADOPTION VERDICTS — consolidated tables reachable only through the
 * generic entity layer for a reason that is recorded rather than forgotten.
 *
 * `check-table-adoption.mjs` counts tables that migrations 0418+ created and that
 * no feature path imports or queries. That number is meant to fall as each domain
 * is migrated onto the target schema, so almost every entry belongs in the
 * baseline as work.
 *
 * An entry here is the exception: a table whose writer is deliberately not built
 * yet, argued once so the row is not an unexplained artefact in the schema.
 */
export default {
  youtube_uploads:
    'the wait is RECORDED, not silent. Migration 1095 argues for a chunked, resumable, ' +
      'Worker-eviction-surviving upload; what shipped alongside it was the SINGLE-SHOT path ' +
      '(`youtubePublishing.publishCanvasVideoToYouTube`), which streams an R2 object straight ' +
      'into Google’s resumable session and works only while the whole object fits one ' +
      'request’s budget. This table is the durable half and its writer is the chunk sweep, ' +
      'which is not written yet. Adjudicated rather than baselined because it is not a ' +
      'domain awaiting migration — it is one feature awaiting its second half, tracked in ' +
      'ROADMAP.md. The verdict leaves this file the day the sweep lands.',
  replay_segments:
    'PRD 33 Insights definitions created with the data plane (S1, migration 1216) so the schema lands in one reviewed migration, while their writers are later slices of the same PRD: S4c `replaySegments` (saved filters). Registered in growth/entities.ts (read-only; site-keyed with no tenant column, so the generic layer can neither list nor edit them). The verdict leaves this file the day that writer lands.',
  replay_smart_events:
    'PRD 33 Insights definitions created with the data plane (S1, migration 1216) so the schema lands in one reviewed migration, while their writers are later slices of the same PRD: S4c `replaySmartEvents` (point-and-click rules). Registered in growth/entities.ts (read-only; site-keyed with no tenant column, so the generic layer can neither list nor edit them). The verdict leaves this file the day that writer lands.',
  replay_funnels:
    'PRD 33 Insights definitions created with the data plane (S1, migration 1216) so the schema lands in one reviewed migration, while their writers are later slices of the same PRD: S4c `ReplayFunnelService`. Registered in growth/entities.ts (read-only; site-keyed with no tenant column, so the generic layer can neither list nor edit them). The verdict leaves this file the day that writer lands.',
  replay_funnel_steps:
    'PRD 33 Insights definitions created with the data plane (S1, migration 1216) so the schema lands in one reviewed migration, while their writers are later slices of the same PRD: S4c `ReplayFunnelService`. Registered in growth/entities.ts (read-only; site-keyed with no tenant column, so the generic layer can neither list nor edit them). The verdict leaves this file the day that writer lands.',
  replay_prescriptions:
    'PRD 33 Insights definitions created with the data plane (S1, migration 1216) so the schema lands in one reviewed migration, while their writers are later slices of the same PRD: S4e `prescriptionSweep` / `prescriptionActions` / `prescriptionVerify`. Registered in growth/entities.ts (read-only; site-keyed with no tenant column, so the generic layer can neither list nor edit them). The verdict leaves this file the day that writer lands.',
  replay_page_captures:
    'PRD 33 Insights definitions created with the data plane (S1, migration 1216) so the schema lands in one reviewed migration, while their writers are later slices of the same PRD: S4f `pageCapture` (QA runner `page_capture` job). Registered in growth/entities.ts (read-only; site-keyed with no tenant column, so the generic layer can neither list nor edit them). The verdict leaves this file the day that writer lands.',
  ai_usage_records:
    'superseded, not awaiting a writer. Migration 0426 declared it as the Agents & runtime target for AI usage, but `llm_usage_log` is the one usage ledger every gateway, BYO and agent call already writes, so a second table would be a second answer to "what did this cost". Nothing inserts into it; the only references are the read-only entity registration in domains/agents/entities.ts and a comment in kernel/rollups/agents.ts recording that the rollup deliberately does NOT read it. Adjudicated rather than baselined because no domain migration will ever give it a writer; the verdict leaves this file the day the table is dropped.',
  sync_entity_mappings:
    'a wait that is RECORDED, not silent. Migration 1247 shipped the whole sync schema in one reviewed migration while the PERSISTENCE half of the batch protocol is a later slice: the ports are written (application/sync/syncPorts.ts declares SyncEntityMappingRow and SyncRecordRow, and syncRepository.ts drives them through the ports) but the Postgres implementation of SyncRepository does not exist yet, so nothing queries these two tables. They are registered read-only in domains/sync/entities.ts so they are readable, never writable through the generic layer. The verdict leaves this file the day `infrastructure/repositories/SyncRepository.ts` lands.',
  sync_records:
    'the same recorded wait as sync_entity_mappings, and deliberately NOT swept: sync_events (90d) and sync_changes (30d) are the disposable pair, while the mapping row and the projection row are not — sync_records is what a client resnapshots from, and deleting it would strand every device that has not yet pulled past the retention window. Registered read-only in domains/sync/entities.ts. The verdict leaves this file the day `infrastructure/repositories/SyncRepository.ts` lands.',
  sessions:
    'superseded, not awaiting a writer. Migration 0430 declared it as the Identity & tenancy target, but login sessions are owned by `auth_user_sessions` (source-to-target.tsv maps the source auth_user_sessions to it, keep) which sessionDirectory and the auth flow already read and write. Nothing inserts into `sessions`; the only reference is the read-only entity registration in domains/identity/entities.ts. Adjudicated rather than baselined because no domain migration will ever give it a writer; the verdict leaves this file the day the table is dropped.',
};
