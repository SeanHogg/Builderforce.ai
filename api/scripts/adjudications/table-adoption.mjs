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
};
