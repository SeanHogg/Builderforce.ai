/**
 * The page-review actions (PRD 33 §5.2 "Prompt", §5.1.4) — rows of THE
 * `PRESCRIPTION_ACTIONS` registry, split out to keep the registry file small.
 *
 *   copy-prompt        the fix's improvement prompt (compiled on read, never stored);
 *                      a proposed fix becomes `applied` with `action_ref = 'manual'`
 *   apply-page         every accepted fix on the page, bundled into ONE prompt; each
 *                      proposed one becomes `applied` / `manual`
 *   apply-in-composer  a hosted canvas app: `applied` with `action_ref = 'composer'`
 *                      until the canvas publishes; answers the `composer` prompt and the
 *                      selectors the canvas pushes as `previewPick` chips
 *
 * Nothing here changes the site. The release that ships a hand-applied fix starts its
 * verification (`prescriptionReleaseHooks.ts`): the next release first seen for a
 * `manual` fix, the canvas publish for a `composer` one.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { replayPrescriptions } from '../../infrastructure/database/schema';
import { ConflictError } from '../../domain/shared/errors';
import { pagePrompt, parseAudience, prescriptionPrompt } from './pagePrompts';
import { REPLAY_TRACE_VERBS } from './replayTrace';
import type { PrescriptionActionDef } from './prescriptionActions';

/** `action_ref` while a hand-applied fix waits for the release that ships it. */
export const MANUAL_ACTION_REF = 'manual';
/** `action_ref` while an apply-in-composer fix waits for the canvas publish. */
export const COMPOSER_ACTION_REF = 'composer';

const copyPrompt: PrescriptionActionDef = {
  action: 'copy-prompt',
  verb: REPLAY_TRACE_VERBS.prescriptionCopyPrompt,
  async run(ctx) {
    const audience = parseAudience(ctx.input.audience);
    const compiled = await prescriptionPrompt(ctx.env, ctx.db, ctx.scope, ctx.row.id, audience);
    const result = { prompt: compiled.prompt, selectors: compiled.selectors };
    // Copying again (the fix is already applied) changes nothing.
    if (ctx.row.status !== 'proposed') return { set: {}, acted: false, result };
    return { set: { status: 'applied', actionKind: 'copy_prompt', actionRef: MANUAL_ACTION_REF }, result };
  },
};

const applyPage: PrescriptionActionDef = {
  action: 'apply-page',
  verb: REPLAY_TRACE_VERBS.prescriptionApplyPage,
  async run(ctx) {
    if (!ctx.row.pagePath) throw new ConflictError('This fix is not about a page');
    const compiled = await pagePrompt(ctx.env, ctx.db, ctx.scope, ctx.row.pagePath, parseAudience(ctx.input.audience));
    // Every OTHER proposed fix on the page joins the bundle (the route writes this row).
    const others = compiled.prescriptionIds.filter((id) => id !== ctx.row.id);
    if (others.length > 0) {
      await ctx.db
        .update(replayPrescriptions)
        .set({ status: 'applied', actionKind: 'apply_page', actionRef: MANUAL_ACTION_REF, decidedBy: ctx.actorId, updatedAt: ctx.now })
        .where(and(
          eq(replayPrescriptions.siteId, ctx.site.id),
          inArray(replayPrescriptions.id, others),
          eq(replayPrescriptions.status, 'proposed'),
        ));
    }
    const result = { prompt: compiled.prompt, selectors: compiled.selectors, prescriptionIds: compiled.prescriptionIds };
    if (ctx.row.status !== 'proposed') return { set: {}, result };
    return { set: { status: 'applied', actionKind: 'apply_page', actionRef: MANUAL_ACTION_REF }, result };
  },
};

const applyInComposer: PrescriptionActionDef = {
  action: 'apply-in-composer',
  verb: REPLAY_TRACE_VERBS.prescriptionApplyInComposer,
  async run(ctx) {
    if (ctx.site.kind !== 'hosted' || ctx.site.projectId === null) throw new ConflictError('Apply in composer is for apps built on the canvas');
    const compiled = await prescriptionPrompt(ctx.env, ctx.db, ctx.scope, ctx.row.id, 'composer');
    return {
      set: { status: 'applied', actionKind: 'apply_in_composer', actionRef: COMPOSER_ACTION_REF },
      result: { prompt: compiled.prompt, selectors: compiled.selectors },
    };
  },
};

export const PAGE_PRESCRIPTION_ACTIONS: readonly PrescriptionActionDef[] = [copyPrompt, applyPage, applyInComposer];
