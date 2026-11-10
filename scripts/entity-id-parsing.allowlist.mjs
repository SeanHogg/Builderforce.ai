/**
 * The id-shaped regexes `check:entity-id-parsing` lets stand, as DATA (docs/design/typed-entity-ids.md §7, §8).
 *
 * Each entry `{ file, kind, reason }` covers every `kind` ('uuid' | 'integer') finding in `file`. Two reasons qualify:
 * the regex is not about an entity id at all, or it is in the api's non-sync UUID sweep, which §7 logs as its own DRY entry
 * (those move onto `isLocalId` with that entry, and leave this list then). An entry that matches nothing fails the guard.
 *
 * @type {{ file: string; kind: 'uuid' | 'integer'; reason: string }[]}
 */

/** §7: the api's UUID checks outside sync. Each validates a route/param id; they move onto `isLocalId` with the §7 DRY entry. */
const API_NON_SYNC_UUID_SWEEP = 'typed-entity-ids §7: api non-sync UUID sweep (own DRY entry); moves onto isLocalId then';

export const ALLOWLIST = [
  // ── Not an entity id ────────────────────────────────────────────────────────────────────────────────────────────────
  {
    file: 'brain-embedded/src/run/parity/normalise.ts',
    kind: 'uuid',
    reason: 'Parity snapshot normaliser: REPLACES every UUID in recorded text with a placeholder (a global scan, not an id check). Oracle code (PRD 35 §5.1).',
  },
  {
    file: 'clients/vscode/src/kimiCodeInstall.ts',
    kind: 'integer',
    reason: "TOML scalar reader for Kimi's config.toml: `/^-?\\d+$/` reads an integer config value, not an id.",
  },
  {
    file: 'api/src/application/quality/errorSpec.ts',
    kind: 'uuid',
    reason: 'normalizeErrorMessage redacts UUIDs inside free error text to `<uuid>` (a global replace, not an id check).',
  },
  // ── §7: api non-sync UUID sweep ─────────────────────────────────────────────────────────────────────────────────────
  ...[
    'api/src/application/agent/AgentAssignmentService.ts',
    'api/src/application/collection/pollFacilitation.ts',
    'api/src/application/commerce/advisorySessionPlan.ts',
    'api/src/application/creation/creationGraphWriter.ts',
    'api/src/application/delivery/agileCost.ts',
    'api/src/application/investor/dataRoomSharing.ts',
    'api/src/application/meetings/mediaRoomAccess.ts',
    'api/src/application/project/ProjectService.ts',
    'api/src/application/replay/replayReadModel.ts',
    'api/src/application/sales/sellMotionService.ts',
    'api/src/application/swimlane/resolveAssignedAgent.ts',
    'api/src/application/workflow/subflowDefinitionGateway.ts',
    'api/src/domain/learning/xapiStatement.ts',
    'api/src/domain/replay/replayScope.ts',
    'api/src/domain/replay/summaryCitations.ts',
    'api/src/presentation/routes/canvasInviteLinkRoutes.ts',
    'api/src/presentation/routes/canvasWidgetHostRoutes.ts',
    'api/src/presentation/routes/creationSessionRoutes.ts',
    'api/src/presentation/routes/ideProjectRoutes.ts',
    'api/src/presentation/routes/ideRoutes.ts',
    'api/src/presentation/routes/innovationRoutes.ts',
    'api/src/presentation/routes/projectMediaRoutes.ts',
    'api/src/presentation/routes/sellMotionRoutes.ts',
    'api/src/presentation/routes/videoRoutes.ts',
    'api/src/presentation/routes/voiceProvenanceRoutes.ts',
    'api/src/presentation/routes/youtubeRoutes.ts',
  ].map((file) => ({ file, kind: /** @type {'uuid'} */ ('uuid'), reason: API_NON_SYNC_UUID_SWEEP })),
];
