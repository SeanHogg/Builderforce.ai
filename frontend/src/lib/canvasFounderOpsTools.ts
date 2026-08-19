/**
 * The canvas's FOUNDER-OPERATIONS vocabulary — the counterparty, and the one
 * pipeline.
 *
 * ── WHAT THESE CLOSE ────────────────────────────────────────────────────────
 * Two defects of the same shape, from opposite ends of the board.
 *
 * `canvas_sync_account` is the counterparty half. The canvas had no object for an
 * account you had WON: `company` is us, `competitor` is them, `salesContact` is a
 * person and `customerSegment` is a cohort. So every commercial reference —
 * `invoice.customer`, `bill.vendor`, `contract.counterparty` — was matched by
 * typed string, and joining a contract to its invoices was a comparison two
 * spellings could break. The kernel's `party_roles` has always held exactly one
 * row per (tenant, party, role); the canvas simply could not see it. This is the
 * seeing.
 *
 * `canvas_sync_sales_pipeline` and `canvas_move_deal` are the pipeline half. The
 * board and the CRM were two systems of record synchronised by a PROMPT
 * INSTRUCTION — "after a successful sales mutation, mirror the returned canonical
 * id and current values into the matching canvas object" — which fails in the
 * direction nobody notices: the board keeps showing what it was last told, and
 * the two disagree silently until somebody forecasts off the wrong one.
 *
 * ── WHY A MOVE IS ONE TOOL AND NOT TWO ──────────────────────────────────────
 * `canvas_move_deal` writes the DEAL and returns the reprojected board, and the
 * tool writes that board onto the object in the same call. There is no "now
 * mirror it" step, because a step that can be forgotten is a step that will be.
 * That is the whole fix: not a better instruction, a removed one.
 *
 * ── WHY A MODULE AND NOT MORE OF CreationCanvas.tsx ─────────────────────────
 * The canvas component is ~9 700 lines with one ~3 700-line action `useMemo`.
 * These are pure functions over an injected context, so they are unit-testable
 * without React or a board — the same argument `canvasBuildTools.ts` makes.
 */

import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { ACCOUNT_RELATIONSHIPS, partyRef } from '@builderforce/creation-canvas-contract';
import { getEntityRows } from '@/lib/kernel/kernelApi';
import { accountHistory, moveDeal, readPipeline, type AccountHistory, type ProjectedPipeline } from '@/lib/founderOpsApi';

/** What the canvas hands these tools so they can author onto the board. */
export interface CanvasFounderOpsContext {
  /**
   * The board these tools are acting on.
   *
   * Added for the sell-motion family, whose routes are addressed by session
   * (`/api/sell-motion/:id/objects/:objectId/...`) because a call, a trust packet and a
   * trial are all read and written THROUGH the board they sit on. On the context rather
   * than curried into that one family, because it is a property of the surface every tool
   * here already runs inside — and a second, family-local way of learning which board this
   * is would be a second thing to keep in step with the canvas.
   *
   * Empty string on a board with no server session; the tools that need it are already
   * refused by `hasTenant`.
   */
  sessionId: string;
  /** False on an unsaved or anonymous board: every tool here reaches a tenant. */
  hasTenant: boolean;
  /** False when the session role may not edit. */
  canEdit: boolean;
  /** Objects on the board, staged additions included, so a tool called twice in
   *  one turn refreshes rather than duplicating. A function, not a value, so the
   *  actions read current state without re-registering on every board change. */
  objects: () => Array<{ id: string; kind: string; title: string; data: Record<string, unknown> }>;
  /** Stage an object addition for review. */
  addObject: (kind: string, fields: Record<string, unknown>, at?: { x?: number; y?: number }) => { objectId: string };
  /** Stage an object update for review. */
  updateObject: (objectId: string, patch: Record<string, unknown>, label: string) => void;
}

/** Cap on how many counterparties one sync will author. A board is a working
 *  surface; a thousand accounts is an export, and the entity browser is where
 *  that belongs. */
const MAX_ACCOUNTS = 25;

/** The `party_roles` shape the kernel reader returns. */
type PartyRoleRow = {
  partyKind?: unknown;
  partyRef?: unknown;
  role?: unknown;
  status?: unknown;
  startedAt?: unknown;
  attrs?: unknown;
};

const text = (value: unknown, max = 200): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/**
 * A counterparty's display name.
 *
 * `party_ref` is a slug and a card titled "acme-holdings-ltd" is a card nobody
 * recognises, so a name from `attrs` wins where the writer supplied one. The
 * fallback un-slugs rather than showing the raw ref: an imperfect "Acme Holdings
 * Ltd" is right far more often than it is wrong, and it is always more legible.
 */
export function counterpartyTitle(row: PartyRoleRow): string {
  const attrs = row.attrs && typeof row.attrs === 'object' ? row.attrs as Record<string, unknown> : {};
  const named = text(attrs.name) || text(attrs.legalName) || text(attrs.displayName);
  if (named) return named;
  return text(row.partyRef)
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** The canvas `account` fields one `party_roles` row projects to. */
export function accountFieldsFrom(row: PartyRoleRow): Record<string, unknown> {
  const attrs = row.attrs && typeof row.attrs === 'object' ? row.attrs as Record<string, unknown> : {};
  const title = counterpartyTitle(row);
  return {
    title,
    status: text(row.status) || 'active',
    partyRef: text(row.partyRef, 64),
    relationship: text(row.role, 32),
    ...(text(attrs.legalName) ? { legalName: text(attrs.legalName) } : {}),
    ...(text(attrs.website) ? { website: text(attrs.website) } : {}),
    ...(text(attrs.owner) ? { owner: text(attrs.owner) } : {}),
    ...(text(attrs.segment) ? { segment: text(attrs.segment) } : {}),
    ...(typeof row.startedAt === 'string' ? { since: row.startedAt.slice(0, 10) } : {}),
    summary: `Synced from the workspace's counterparty register (${text(row.role, 32) || 'contact'}).`,
  };
}

/**
 * The `account.history` rows a sync writes — open invoices and open bills,
 * merged and ordered by due date so the earliest obligation on either side
 * reads first. A missing `due` sorts last rather than first: an amount with no
 * due date is not the most urgent one, it is the least dated.
 */
export function historyRowsFrom(history: AccountHistory): Record<string, unknown>[] {
  return [...history.openInvoices, ...history.openBills]
    .map((doc) => ({ kind: doc.kind, reference: doc.reference, amount: doc.amount, currency: doc.currency, due: doc.due, status: doc.status }))
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
}

/** The canvas `salesPipeline` fields a projection writes. */
export function pipelineFieldsFrom(pipeline: ProjectedPipeline): Record<string, unknown> {
  return {
    stages: pipeline.stages,
    swimlanes: pipeline.lanes,
    // `dealId` rides each card, which is what makes the board a handle on the
    // CRM rather than a copy of it: `canvas_move_deal` reads it back.
    cards: pipeline.cards,
    status: `${pipeline.totals.open} open`,
    summary:
      `${pipeline.totals.open} open deals worth ${(pipeline.totals.openValueCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}, `
      + `${pipeline.totals.won} won. Projected from the CRM at ${pipeline.syncedAt.slice(0, 16).replace('T', ' ')} — `
      + 'this card is a view of the deals, not a second copy of them, so edit it by moving a deal rather than by rewriting the rows.',
  };
}

const NO_TENANT = 'This needs a signed-in, saved canvas session: it reads workspace records, and an anonymous board has no workspace behind it. Say so in one sentence and author what this board can hold — never claim it ran.';

export function canvasFounderOpsActions(ctx: CanvasFounderOpsContext): BrainAction[] {
  const guard = (): { error: string } | null => {
    if (!ctx.hasTenant) return { error: NO_TENANT };
    if (!ctx.canEdit) return { error: 'The current session role cannot edit this canvas' };
    return null;
  };

  return [
    {
      name: 'canvas_sync_account',
      description:
        'Put the workspace\'s real COUNTERPARTIES on the canvas as `account` objects — the customers, vendors, investors and partners it already holds. Call this whenever the user names a customer or supplier ("what do we owe Acme", "show me the Northwind account"), and BEFORE authoring an invoice, bill or contract, so the counterparty on it matches an account that exists rather than a typed string. Creates each account when absent and refreshes it when present, and projects its real OPEN invoices and open bills onto `history` in the same call — no separate refresh needed to answer "what does Acme owe us". If the workspace has no counterparty of the requested kind, the result says so — author an `account` from what the user tells you rather than inventing one.',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          relationship: {
            type: 'string',
            enum: [...ACCOUNT_RELATIONSHIPS],
            description: 'Restrict to one relationship. Omit to sync every counterparty the workspace holds.',
          },
          name: { type: 'string', description: 'Sync only the counterparty whose name or reference matches this. Use it when the user named ONE company.' },
          limit: { type: 'number', minimum: 1, maximum: MAX_ACCOUNTS },
          x: { type: 'number' }, y: { type: 'number' },
        },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as { relationship?: string; name?: string; limit?: number; x?: number; y?: number };

        const page = await getEntityRows('kernel', 'party_roles', { limit: 200 });
        const rows = (page.rows as PartyRoleRow[])
          .filter((row) => text(row.status) !== 'ended')
          .filter((row) => !args.relationship || text(row.role) === args.relationship)
          .filter((row) => {
            if (!args.name) return true;
            const needle = partyRef(args.name);
            return text(row.partyRef).includes(needle) || partyRef(counterpartyTitle(row)).includes(needle);
          });

        if (!rows.length) {
          return {
            accountsFound: false,
            reason: args.name ? 'no-match' : 'no-counterparties',
            instruction: args.name
              ? `No counterparty in this workspace matches "${args.name}". Ask the user to confirm the legal name, or author an \`account\` object from what they have already told you. Never invent one.`
              : 'This workspace has no counterparty records yet. Author an `account` object from what the user tells you — its `partyRef` should be the lowercase hyphenated form of the legal name.',
          };
        }

        const limit = Math.max(1, Math.min(Math.round(args.limit ?? MAX_ACCOUNTS), MAX_ACCOUNTS));
        const existing = ctx.objects().filter((object) => object.kind === 'account');
        const targets = rows.slice(0, limit).map((row) => accountFieldsFrom(row));

        // Fetched in parallel and merged BEFORE any object is staged, so a slow or
        // failed history read never blocks — or half-populates — the sync itself.
        // FO-A3's projection: real open invoices and bills, never authored.
        const histories = await Promise.all(targets.map((fields) => {
          const ref = String(fields.partyRef ?? '');
          return ref ? accountHistory(ref).catch(() => null) : Promise.resolve(null);
        }));

        const synced: Array<{ objectId: string; title: string; partyRef: string; updated: boolean }> = [];

        targets.forEach((fields, i) => {
          const ref = String(fields.partyRef ?? '');
          const history = histories[i];
          const withHistory = history ? { ...fields, history: historyRowsFrom(history) } : fields;
          // Matched on `partyRef` and NOT on title: the ref is the identity, and
          // matching on a display name is the exact defect this object removes.
          const match = existing.find((object) => text(object.data.partyRef, 64) === ref);
          if (match) {
            ctx.updateObject(match.id, withHistory, `Refreshed ${fields.title}`);
            synced.push({ objectId: match.id, title: String(fields.title), partyRef: ref, updated: true });
          } else {
            const { objectId } = ctx.addObject('account', withHistory, { ...(args.x != null ? { x: args.x } : {}), ...(args.y != null ? { y: args.y } : {}) });
            synced.push({ objectId, title: String(fields.title), partyRef: ref, updated: false });
          }
        });

        return {
          ok: true, proposed: true, accountsFound: true,
          accounts: synced,
          ...(rows.length > limit ? { moreAvailable: rows.length - limit } : {}),
          instruction: 'Use each account\'s TITLE verbatim as the counterparty on any invoice, bill or contract you author against it, so the objects join to one another instead of to two spellings of one name.',
        };
      },
    },
    {
      name: 'canvas_sync_sales_pipeline',
      description:
        'Put the workspace\'s REAL sales pipeline on the canvas as a `salesPipeline` object — the deals, their stages and their values, read from the CRM. Call this before answering anything about pipeline, forecast, coverage or a named deal, and instead of authoring pipeline cards by hand: a hand-authored pipeline is a second set of numbers that starts disagreeing with the CRM immediately. The card this writes is a VIEW of the deals, so refreshing it is always safe and never loses work.',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          pipelineRef: { type: 'string', description: 'Restrict to one named pipeline. Omit for every sales deal in the workspace.' },
          laneBy: { type: 'string', enum: ['source', 'owner', 'none'], description: 'What the swimlanes segment by. Defaults to source.' },
          objectId: { type: 'string', description: 'Existing salesPipeline object to refresh. Omit to reuse the one on the board, or create one.' },
          x: { type: 'number' }, y: { type: 'number' },
        },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as { pipelineRef?: string; laneBy?: 'source' | 'owner' | 'none'; objectId?: string; x?: number; y?: number };
        const pipeline = await readPipeline({
          ...(args.pipelineRef ? { pipelineRef: args.pipelineRef } : {}),
          ...(args.laneBy ? { laneBy: args.laneBy } : {}),
        });

        if (!pipeline.cards.length) {
          return {
            pipelineFound: false,
            instruction: 'This workspace has no sales deals yet, so there is no pipeline to project. Say so plainly — do NOT author a pipeline card with example deals, because a board that shows invented deals beside real numbers is worse than an empty one.',
          };
        }

        const fields = pipelineFieldsFrom(pipeline);
        const objects = ctx.objects();
        const target = args.objectId
          ? objects.find((object) => object.id === args.objectId)
          : objects.find((object) => object.kind === 'salesPipeline');

        if (target) {
          ctx.updateObject(target.id, fields, `Pipeline refreshed — ${pipeline.totals.open} open`);
          return { ok: true, proposed: true, pipelineFound: true, objectId: target.id, ...pipeline.totals, stages: pipeline.stages };
        }
        const { objectId } = ctx.addObject('salesPipeline', { title: 'Sales pipeline', ...fields }, {
          ...(args.x != null ? { x: args.x } : {}), ...(args.y != null ? { y: args.y } : {}),
        });
        return { ok: true, proposed: true, pipelineFound: true, objectId, ...pipeline.totals, stages: pipeline.stages };
      },
    },
    {
      name: 'canvas_move_deal',
      description:
        'Move a deal to a different stage. This changes the DEAL in the CRM and rewrites the pipeline card on the board from the result, in one call — so never follow it with an update to the card, and never edit a pipeline card\'s rows to record a stage change. Pass the `dealId` carried on the card (canvas_sync_sales_pipeline puts it there); if you do not have one, sync the pipeline first rather than guessing.',
      parameters: {
        type: 'object', required: ['dealId', 'stage'], additionalProperties: false,
        properties: {
          dealId: { type: 'number', description: 'The canonical deal id from the card.' },
          stage: { type: 'string', description: 'The stage key to move it to. Must be one of the stages on the pipeline card.' },
          laneBy: { type: 'string', enum: ['source', 'owner', 'none'] },
        },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as { dealId?: number; stage?: string; laneBy?: 'source' | 'owner' | 'none' };
        if (!Number.isFinite(args.dealId)) return { error: 'Pass the numeric dealId carried on the pipeline card. Call canvas_sync_sales_pipeline first if the card has none.' };
        if (!args.stage) return { error: 'Pass the stage to move it to.' };

        const pipeline = await moveDeal(Number(args.dealId), args.stage, { ...(args.laneBy ? { laneBy: args.laneBy } : {}) });
        const fields = pipelineFieldsFrom(pipeline);
        const target = ctx.objects().find((object) => object.kind === 'salesPipeline');
        // The board is rewritten from the SAME response that performed the write,
        // which is what makes the two impossible to leave out of step.
        if (target) ctx.updateObject(target.id, fields, `Deal moved to ${args.stage}`);

        return {
          ok: true, proposed: true, movedTo: args.stage,
          boardUpdated: Boolean(target),
          ...pipeline.totals,
          instruction: 'The CRM and the board are both updated. Do not call canvas_update_object to mirror this.',
        };
      },
    },
  ];
}
