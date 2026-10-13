/**
 * The `follow-up` row of THE `PRESCRIPTION_ACTIONS` registry (PRD 33 §5.1.4), split
 * out to keep the registry file small.
 *
 *   preview (no `confirm`)   who WOULD be enrolled and the fixed first touch; with
 *                            `draftSequence`, also a NEW 2–3 step sequence drafted
 *                            from the finding's cited objection (`prescriptionFollowUpDraft`)
 *                            for the person to edit. Nothing is written.
 *   confirm                  enrol the matched contacts into the chosen `sequence` —
 *                            or, with `newSequence` (the edited draft), first create
 *                            that sequence on a board through THE server-side object
 *                            placement (`placeCanvasObject` → `creationGraphStatements`,
 *                            the graph write every canvas object goes through), then
 *                            enrol into it.
 *
 * Insights never sends. A created sequence is a `draft` cadence (`sequenceState`) —
 * the runner (`sales/sequenceRunner.runSequenceSweep`) sends only once a person starts
 * it on its board, under the same gated `start` action and send policy as every other
 * cadence. Placement is idempotent per fix (resource `replay_prescription:<id>`), so a
 * retried confirm enrols into the sequence it already created.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { ReplayFollowUpSequenceDraftDto } from '@builderforce/interaction-contract';
import type { Db } from '../../infrastructure/database/connection';
import {
  SESSION_PROJECT_LINK_APP,
  creationSessionObjects,
  creationSessionProjectLinks,
  creationSessions,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { ConflictError, ValidationError } from '../../domain/shared/errors';
import { placeCanvasObject } from '../canvas/placeCanvasObject';
import { assertFollowUpReachable, enrolFollowUp, loadSequence, previewFollowUp } from './prescriptionFollowUp';
import { cleanSequenceDraft, draftFollowUpSequence } from './prescriptionFollowUpDraft';
import type { PrescriptionRow } from './prescriptionReads';
import type { ReplaySiteRecord } from './replaySites';
import { REPLAY_TRACE_VERBS } from './replayTrace';
import type { ActionContext, PrescriptionActionDef } from './prescriptionActions';

/** The resource a created sequence card points at — one per fix per board. */
export const FOLLOW_UP_SEQUENCE_RESOURCE = 'replay_prescription';

/** Pure: the `sequence` object's content for a confirmed draft — a DRAFT cadence of email steps. */
export function followUpSequenceContent(
  draft: ReplayFollowUpSequenceDraftDto,
  row: Pick<PrescriptionRow, 'id' | 'ruleId' | 'pagePath'>,
  site: Pick<ReplaySiteRecord, 'id' | 'label'>,
): Record<string, unknown> {
  return {
    kind: 'sequence',
    title: draft.name,
    name: draft.name,
    status: 'draft',
    // Only `running` sends; a person starts it on the board (the gated `start` action).
    sequenceState: 'draft',
    direction: 'sales',
    audience: `Identified visitors of ${site.label || 'the site'} (${row.ruleId}${row.pagePath ? ` on ${row.pagePath}` : ''})`.slice(0, 300),
    steps: draft.steps.map((step) => ({ dayOffset: step.delayDays, channel: 'email', subject: step.subject, body: step.body })),
    stopOnReply: true,
    enrolments: [],
    source: { kind: 'insights_prescription', prescriptionId: row.id, siteId: site.id },
  };
}

/**
 * The board a new sequence goes on: a hosted app's own board (where Measure ▸ Visitors
 * is opened), else the board the workspace's newest cadence lives on. 409 when there is
 * neither — the person then picks an existing sequence or adds one on a canvas.
 */
async function followUpBoardOf(db: Db, tenantId: number, site: ReplaySiteRecord): Promise<string> {
  if (site.kind === 'hosted' && site.projectId !== null) {
    const [app] = await db
      .select({ sessionId: creationSessionProjectLinks.sessionId })
      .from(creationSessionProjectLinks)
      .innerJoin(creationSessions, eq(creationSessions.id, creationSessionProjectLinks.sessionId))
      .where(scopedToTenant(creationSessions, tenantId, and(
        eq(creationSessionProjectLinks.projectId, site.projectId),
        eq(creationSessionProjectLinks.linkKind, SESSION_PROJECT_LINK_APP),
        eq(creationSessions.status, 'active'),
      )))
      .limit(1);
    if (app) return app.sessionId;
  }
  const [cadence] = await db
    .select({ sessionId: creationSessionObjects.sessionId })
    .from(creationSessionObjects)
    .innerJoin(creationSessions, eq(creationSessions.id, creationSessionObjects.sessionId))
    .where(scopedToTenant(creationSessions, tenantId, eq(creationSessionObjects.kind, 'sequence'), eq(creationSessions.status, 'active')))
    .orderBy(desc(creationSessionObjects.updatedAt))
    .limit(1);
  if (cadence) return cadence.sessionId;
  throw new ConflictError('There is no board to put a new sequence on yet; choose an existing sequence or add one on a canvas');
}

/** Create the confirmed draft as a `sequence` on its board; answers the object id. */
export async function createFollowUpSequence(ctx: ActionContext, draft: ReplayFollowUpSequenceDraftDto): Promise<string> {
  if (!ctx.actorId) throw new ValidationError('A person creates a new sequence');
  const sessionId = await followUpBoardOf(ctx.db, ctx.scope.tenantId, ctx.site);
  const placed = await placeCanvasObject(ctx.db, ctx.env, {
    sessionId,
    tenantId: ctx.scope.tenantId,
    userId: ctx.actorId,
    kind: 'sequence',
    resourceType: FOLLOW_UP_SEQUENCE_RESOURCE,
    resourceId: ctx.row.id,
    content: followUpSequenceContent(draft, ctx.row, ctx.site),
    eventType: 'canvas.sequence_drafted',
    eventPayload: { prescriptionId: ctx.row.id, siteId: ctx.site.id },
  });
  if (!placed) throw new ConflictError('The board for the new sequence is gone; try again');
  // Not placed = already there (a retry: reuse it) or a concurrent writer won (it is not there).
  if (!placed.placed) {
    await loadSequence(ctx.db, ctx.scope.tenantId, placed.objectId).catch(() => {
      throw new ConflictError('The board changed while the sequence was being added; try again');
    });
  }
  return placed.objectId;
}

export const FOLLOW_UP_PRESCRIPTION_ACTION: PrescriptionActionDef = {
  action: 'follow-up',
  verb: REPLAY_TRACE_VERBS.prescriptionFollowUp,
  preview: (input) => input.confirm !== true,
  async run(ctx) {
    const base = { actorId: ctx.actorId, now: ctx.now };
    if (ctx.input.confirm !== true) {
      // The draft and the people first; nothing is written until a person confirms.
      const preview = await previewFollowUp(ctx.env, ctx.db, ctx.scope, ctx.row, base);
      const followUp = ctx.input.draftSequence === true
        ? { ...preview, draftSequence: await draftFollowUpSequence(ctx.env, ctx.scope.tenantId, ctx.row, ctx.now) }
        : preview;
      return { set: {}, acted: false, result: { followUp } };
    }
    let sequenceObjectId: string;
    let createdSequence: { id: string; name: string } | undefined;
    if (ctx.input.newSequence) {
      const draft = cleanSequenceDraft(ctx.input.newSequence);
      // Nobody to enrol → refuse BEFORE a card is put on anyone's board.
      await assertFollowUpReachable(ctx.env, ctx.db, ctx.scope, ctx.row, { contactIds: ctx.input.contactIds, now: ctx.now });
      sequenceObjectId = await createFollowUpSequence(ctx, draft);
      createdSequence = { id: sequenceObjectId, name: draft.name };
    } else {
      sequenceObjectId = typeof ctx.input.sequenceObjectId === 'string' ? ctx.input.sequenceObjectId : '';
      if (!sequenceObjectId) throw new ValidationError('Choose the sequence to enrol into');
    }
    const enrolled = await enrolFollowUp(ctx.env, ctx.db, ctx.scope, ctx.row, { sequenceObjectId, contactIds: ctx.input.contactIds, now: ctx.now });
    const preview = await previewFollowUp(ctx.env, ctx.db, ctx.scope, ctx.row, { ...base, enrolled });
    return {
      set: { status: 'applied', actionKind: 'follow_up', refs: { ...ctx.refs, sequenceObjectId } },
      result: { followUp: createdSequence ? { ...preview, createdSequence } : preview },
    };
  },
};
