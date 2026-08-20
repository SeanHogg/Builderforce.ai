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
import { DEFAULT_LOCALE } from '@/i18n/config';
import { formatterFor } from '@/i18n/format';
import { ACCOUNT_RELATIONSHIPS, partyRef } from '@builderforce/creation-canvas-contract';
import { getEntityRows } from '@/lib/kernel/kernelApi';
import { ROUND_INSTRUMENTS, ROUND_STATUSES, ROUND_TYPES, accountHistory, listPayRuns, logDealTouch, moveDeal, openDeal, payRunLines, planFundingRound, readPipeline, syncPayRuns, type AccountHistory, type PayRunSummary, type ProjectedPipeline } from '@/lib/founderOpsApi';

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

/** The canvas object kind each pipeline family projects ONTO. Data, not a branch:
 *  a third family is one entry here and in `pipelineFamilies.ts`, not a third
 *  `if`. */
export const PIPELINE_OBJECT_KIND: Readonly<Record<string, string>> = {
  sales: 'salesPipeline',
  raise: 'fundingRound',
};

/**
 * Pinned to the default locale, NOT the reader's.
 *
 * Everything below writes PERSISTED canvas object data — English prose summaries
 * that a tool result and the next turn both read. A number that groups one way
 * for a German reader and another for an English one would make the stored value
 * depend on who happened to be looking at the board when it was computed.
 */
const fmt = formatterFor(DEFAULT_LOCALE);

const usd = (cents: number): string => fmt.currency(cents / 100);

/**
 * The canvas fields a projection writes — for EITHER board.
 *
 * The kanban half (`stages`, `swimlanes`, `cards`) is identical for both, because
 * the raise IS a pipeline: stages across, an allocation at each intersection. What
 * differs is the second reading a `fundingRound` also owes — `investors` is the
 * rows table the card has always drawn, and `committed` is the money actually
 * closed. Both are DERIVED here from the same cards the kanban draws, so the table
 * and the board cannot disagree about a firm's stage, which is precisely what a
 * hand-typed `investors` array made inevitable (FO-E1).
 *
 * `dealId` rides each card, which is what makes either board a handle on the CRM
 * rather than a copy of it: `canvas_move_deal` and the card's own drag both read
 * it back.
 */
export function pipelineFieldsFrom(pipeline: ProjectedPipeline): Record<string, unknown> {
  const raise = pipeline.family === 'raise';
  const base = {
    stages: pipeline.stages,
    swimlanes: pipeline.lanes,
    cards: pipeline.cards,
    syncedAt: pipeline.syncedAt,
  };
  if (!raise) {
    return {
      ...base,
      status: `${pipeline.totals.open} open`,
      summary:
        `${pipeline.totals.open} open deals worth ${usd(pipeline.totals.openValueCents)}, `
        + `${pipeline.totals.won} won. Projected from the CRM at ${pipeline.syncedAt.slice(0, 16).replace('T', ' ')} — `
        + 'this card is a view of the deals, not a second copy of them, so edit it by moving a deal rather than by rewriting the rows.',
    };
  }
  const round = pipeline.round;
  return {
    ...base,
    status: round ? `${round.status} · ${pipeline.totals.open} in play` : `${pipeline.totals.open} in play`,
    // The PLAN, from `funding_rounds` — negotiated and typed, and now a record
    // rather than four fields somebody entered on a card (0937). Absent keys are
    // left alone rather than blanked, so a round nobody has planned yet keeps
    // whatever the founder typed until they plan one.
    ...(round?.roundType ? { roundType: round.roundType } : {}),
    ...(round?.targetAmount != null ? { targetAmount: round.targetAmount } : {}),
    ...(round?.postMoney != null || round?.preMoney != null
      ? { valuation: round.postMoney ?? round.preMoney } : {}),
    ...(round?.closeTargetAt ? { closeTarget: round.closeTargetAt.slice(0, 10) } : {}),
    ...(round ? { roundStatus: round.status, instrument: round.instrument, leadInvestor: round.leadInvestor ?? '' } : {}),
    // The rows table the `fundingRound` card has always drawn — now DERIVED from
    // the same allocations the kanban draws rather than typed beside them.
    investors: pipeline.cards.map((card) => ({
      investor: card.title,
      stage: card.stage,
      amount: card.valueCents == null ? '' : card.valueCents / 100,
      nextStep: card.note,
      warmIntro: card.warmIntro ?? '',
      touches: card.touchCount,
      partyRef: card.partyRef ?? '',
      dealId: card.dealId,
    })),
    // Money actually CLOSED, never money promised: `committed` is what a founder
    // reports to a board, and counting soft circles in it is the single most common
    // way a raise is misreported.
    committed: pipeline.totals.wonValueCents / 100,
    summary:
      `${pipeline.totals.won} closed for ${usd(pipeline.totals.wonValueCents)}, `
      + `${pipeline.totals.open} still in play worth ${usd(pipeline.totals.openValueCents)}. `
      + (round?.targetAmount
        ? `That is ${Math.round((pipeline.totals.wonValueCents / 100 / round.targetAmount) * 100)}% of the ${usd(round.targetAmount * 100)} target. `
        : 'No target has been planned for this round — use canvas_plan_funding_round to record one. ')
      + `Projected from the investor allocations at ${pipeline.syncedAt.slice(0, 16).replace('T', ' ')} — `
      + 'this card is a view of the deals, not a second copy of them, so move a firm with canvas_move_deal and record a conversation with canvas_log_deal_touch rather than rewriting the rows.',
  };
}

/**
 * The canvas `payRun` fields one provider-returned run projects to.
 *
 * Every value here came back from a payroll provider, which is the whole contract
 * of the kind: the platform must never calculate a salary or a tax, so this is a
 * rename and nothing else. `summary` says WHICH provider and WHEN it was read,
 * because a run whose sync is a month old is still a fact and the thing that stops
 * it being mistaken for a live one is the date beside it.
 */
export function payRunFieldsFrom(run: PayRunSummary, lines: Array<{ description: string; quantity: number; unitAmount: number; amount: number }>): Record<string, unknown> {
  const money = (value: number | null): string =>
    value == null ? '' : fmt.currency(value, run.currency);
  return {
    title: `Pay run — ${run.paidAtISO ? run.paidAtISO.slice(0, 10) : run.externalRef}`,
    status: run.status,
    source: run.source,
    externalRef: run.externalRef,
    currency: run.currency,
    periodStart: run.periodStartISO ? run.periodStartISO.slice(0, 10) : '',
    periodEnd: run.periodEndISO ? run.periodEndISO.slice(0, 10) : '',
    paidAt: run.paidAtISO ? run.paidAtISO.slice(0, 10) : '',
    grossAmount: run.grossAmount ?? '',
    employerTaxes: run.employerTaxes ?? '',
    totalCost: run.totalCost,
    employeeCount: run.employeeCount,
    lines: lines.map((line) => ({ employee: line.description, hours: line.quantity, rate: line.unitAmount, amount: line.amount })),
    syncedAt: run.syncedAtISO,
    summary:
      `${money(run.totalCost)} paid to ${run.employeeCount} ${run.employeeCount === 1 ? 'person' : 'people'}`
      + `${run.paidAtISO ? ` on ${run.paidAtISO.slice(0, 10)}` : ''}, read from ${run.source} at ${run.syncedAtISO.slice(0, 16).replace('T', ' ')}. `
      + 'These are the provider\'s own figures — correcting one here would put a number on the board that payroll disagrees with.',
  };
}

const NO_TENANT = 'This needs a signed-in, saved canvas session: it reads workspace records, and an anonymous board has no workspace behind it. Say so in one sentence and author what this board can hold — never claim it ran.';

export function canvasFounderOpsActions(ctx: CanvasFounderOpsContext): BrainAction[] {
  const guard = (): { error: string } | null => {
    if (!ctx.hasTenant) return { error: NO_TENANT };
    if (!ctx.canEdit) return { error: 'The current session role cannot edit this canvas' };
    return null;
  };

  /**
   * Redraw the card a projection belongs to, from the projection itself.
   *
   * ONE helper for four tools, because the rule they share is the one that must
   * never vary: the board is written from the SAME response that performed the
   * write, onto the kind the response's own family names. Four copies of it would
   * be four chances to redraw the wrong card — which is the mirroring defect over
   * again, in a smaller currency.
   *
   * Returns whether a card was found, so a tool can tell the user "the record
   * changed and there is no card for it on this board" rather than implying one
   * was updated.
   */
  const writeBoard = (pipeline: ProjectedPipeline, objectId: string | undefined, label: string): boolean => {
    const kind = PIPELINE_OBJECT_KIND[pipeline.family] ?? 'salesPipeline';
    const objects = ctx.objects();
    const target = objectId ? objects.find((object) => object.id === objectId) : objects.find((object) => object.kind === kind);
    if (!target) return false;
    ctx.updateObject(target.id, pipelineFieldsFrom(pipeline), label);
    return true;
  };

  /** The body BOTH sync tools share. The only thing that differs between a sales
   *  board and a raise board is the family — everything else, including the refusal
   *  to author example rows into an empty one, is identical. */
  const syncPipeline = async (family: 'sales' | 'raise', raw: unknown) => {
    const blocked = guard();
    if (blocked) return blocked;
    const args = raw as { pipelineRef?: string; laneBy?: 'source' | 'owner' | 'none'; objectId?: string; x?: number; y?: number };
    const pipeline = await readPipeline({
      family,
      ...(args.pipelineRef ? { pipelineRef: args.pipelineRef } : {}),
      ...(args.laneBy ? { laneBy: args.laneBy } : {}),
    });

    if (!pipeline.cards.length) {
      return {
        pipelineFound: false,
        instruction: family === 'raise'
          ? 'This workspace has no investor allocations yet, so there is no raise to project. Say so plainly and offer canvas_open_deal for each firm the user actually names — do NOT author a fundingRound with example investors, because a board that shows invented funds beside real numbers is worse than an empty one.'
          : 'This workspace has no sales deals yet, so there is no pipeline to project. Say so plainly — do NOT author a pipeline card with example deals, because a board that shows invented deals beside real numbers is worse than an empty one.',
      };
    }

    const kind = PIPELINE_OBJECT_KIND[family]!;
    if (writeBoard(pipeline, args.objectId, `${family === 'raise' ? 'Round' : 'Pipeline'} refreshed — ${pipeline.totals.open} open`)) {
      const objects = ctx.objects();
      const target = args.objectId ? objects.find((object) => object.id === args.objectId) : objects.find((object) => object.kind === kind);
      return { ok: true, proposed: true, pipelineFound: true, objectId: target?.id ?? null, ...pipeline.totals, stages: pipeline.stages };
    }
    const { objectId } = ctx.addObject(kind, {
      title: family === 'raise' ? (pipeline.pipelineRef || 'Funding round') : 'Sales pipeline',
      ...pipelineFieldsFrom(pipeline),
    }, {
      ...(args.x != null ? { x: args.x } : {}), ...(args.y != null ? { y: args.y } : {}),
    });
    return { ok: true, proposed: true, pipelineFound: true, objectId, ...pipeline.totals, stages: pipeline.stages };
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
      name: 'canvas_sync_pay_run',
      description:
        'Put the workspace\'s REAL pay runs on the canvas as `payRun` objects — what payroll actually cost, read back from the connected provider (Gusto, Rippling, ADP or Deel). Call this before answering anything about payroll cost, burn, runway or "what did we pay last month", and instead of authoring the figures: a typed payroll number is the single largest invented line on any founder\'s forecast. This platform never CALCULATES payroll — it reads the run that happened — so if no provider is connected, say which ones can be and do not estimate.',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          since: { type: 'string', description: 'ISO date — only runs paid on or after this. Omit for the most recent runs.' },
          connectorKey: { type: 'string', description: 'Read from ONE named provider. Omit to use the first connected one — a company has one payroll, and merging two providers would present two different ideas of a pay run as one.' },
          limit: { type: 'number', minimum: 1, maximum: 12, description: 'How many runs to put on the board. Keep it small; a full payroll history is an export, not a card.' },
          x: { type: 'number' }, y: { type: 'number' },
        },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as { since?: string; connectorKey?: string; limit?: number; x?: number; y?: number };

        const hydration = await syncPayRuns({
          since: args.since ?? null,
          connectorKey: args.connectorKey ?? null,
          ...(args.limit ? { limit: args.limit } : {}),
        });

        // A provider that answered with an error is a DIFFERENT fact from a
        // workspace with no payroll connected, and only one of the two is
        // something the user can fix by connecting something.
        if (hydration.error) {
          return {
            payRunsFound: false,
            reason: 'provider-error',
            provider: hydration.source,
            error: hydration.error,
            instruction: `The connected payroll provider answered with an error. Say what it was in one sentence and stop — do NOT author a payRun card with estimated figures, because a board showing invented payroll beside real numbers is worse than an empty one.`,
          };
        }

        const runs = await listPayRuns();
        if (!runs.length) {
          return {
            payRunsFound: false,
            reason: hydration.connectedSources.length ? 'no-runs' : 'no-provider',
            connectedSources: hydration.connectedSources,
            instruction: hydration.connectedSources.length
              ? 'The connected payroll provider returned no runs for that period. Say so plainly and offer to widen the date range.'
              : 'This workspace has no payroll provider connected, so there is nothing to read. Name Gusto, Rippling, ADP or Deel as the ones that can be connected, and say that a run can also be entered by hand from a bureau\'s statement. NEVER estimate a payroll figure — the largest line on a forecast has to be a fact.',
          };
        }

        const limit = Math.max(1, Math.min(Math.round(args.limit ?? 3), 12));
        const targets = runs.slice(0, limit);
        // Lines fetched in parallel and merged BEFORE any object is staged, so a
        // slow read never half-populates the board — the same shape
        // `canvas_sync_account` uses for its histories.
        const lineSets = await Promise.all(targets.map((run) => payRunLines(run.reference).catch(() => [])));

        const existing = ctx.objects().filter((object) => object.kind === 'payRun');
        const synced: Array<{ objectId: string; reference: string; totalCost: number; updated: boolean }> = [];

        targets.forEach((run, index) => {
          const fields = payRunFieldsFrom(run, lineSets[index] ?? []);
          // Matched on the provider's own reference, never on the title: two runs
          // in one month have the same shape of title and different money.
          const match = existing.find((object) => text(object.data.externalRef, 96) === run.externalRef);
          if (match) {
            ctx.updateObject(match.id, fields, `Refreshed pay run ${run.externalRef}`);
            synced.push({ objectId: match.id, reference: run.reference, totalCost: run.totalCost, updated: true });
          } else {
            const { objectId } = ctx.addObject('payRun', fields, { ...(args.x != null ? { x: args.x } : {}), ...(args.y != null ? { y: args.y } : {}) });
            synced.push({ objectId, reference: run.reference, totalCost: run.totalCost, updated: false });
          }
        });

        return {
          ok: true, proposed: true, payRunsFound: true,
          provider: hydration.source,
          imported: hydration.imported,
          payRuns: synced,
          ...(runs.length > limit ? { moreAvailable: runs.length - limit } : {}),
          instruction: 'Use `totalCost` as the payroll line on any burn, forecast or runway answer — it is what the provider says the run cost, including employer taxes. Do not re-derive it from gross, and do not edit these cards: they are a view of the provider\'s records, so refreshing is always safe and editing puts a number on the board payroll disagrees with.',
        };
      },
    },
    {
      name: 'canvas_sync_sales_pipeline',
      description:
        'Put the workspace\'s REAL sales pipeline on the canvas as a `salesPipeline` object — the deals, their stages and their values, read from the CRM. Call this before answering anything about pipeline, forecast, coverage or a named deal, and instead of authoring pipeline cards by hand: a hand-authored pipeline is a second set of numbers that starts disagreeing with the CRM immediately. The card this writes is a VIEW of the deals, so refreshing it is always safe and never loses work. For the FUNDRAISE — investors, rounds, who has committed — call canvas_sync_funding_round instead; it is the same projection over investor allocations.',
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
      run: async (raw: unknown) => syncPipeline('sales', raw),
    },
    {
      name: 'canvas_sync_funding_round',
      description:
        'Put the workspace\'s REAL fundraise on the canvas as a `fundingRound` object — every investor as a named firm, its stage, the amount discussed, the warm-intro path and how many conversations there have been. Call this before answering anything about the raise, a named fund, coverage or how much is committed, and instead of typing rows into a `fundingRound`: a hand-typed investor list is a second set of numbers that starts disagreeing with the record immediately, and it cannot hold a thread. `committed` is money CLOSED, never money promised. To add a firm use canvas_open_deal; to move one use canvas_move_deal; to record a conversation use canvas_log_deal_touch.',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          pipelineRef: { type: 'string', description: 'Restrict to one named round, e.g. "seed-2026". Omit for every investor allocation in the workspace.' },
          laneBy: { type: 'string', enum: ['source', 'owner', 'none'], description: 'What the swimlanes segment by. Defaults to one unsegmented board, which is what a raise usually is.' },
          objectId: { type: 'string', description: 'Existing fundingRound object to refresh. Omit to reuse the one on the board, or create one.' },
          x: { type: 'number' }, y: { type: 'number' },
        },
      },
      mutates: () => true,
      run: async (raw: unknown) => syncPipeline('raise', raw),
    },
    {
      name: 'canvas_plan_funding_round',
      description:
        'Record what a funding round is TRYING to do — the instrument, how much is being raised, the valuation being asked for, the lead, and the date the founder intends to close. This is the round\'s PLAN and it is a real record, not a note on a card: every investor allocation joins to it by name. Use it whenever the user states a target, a valuation or a close date ("we are raising $2m at a $10m post"). It never records how much has been RAISED — that is derived from the allocations, and asserting it would produce two answers to the same question. Idempotent on the name, so changing the plan is the same call.',
      parameters: {
        type: 'object', required: ['name'], additionalProperties: false,
        properties: {
          name: { type: 'string', description: 'What the round is called — "Seed 2026". This is what allocations join to, so reuse it exactly when adding investors with canvas_open_deal.' },
          roundType: { type: 'string', enum: [...ROUND_TYPES] },
          instrument: { type: 'string', enum: [...ROUND_INSTRUMENTS], description: 'What the money buys. Defaults to equity.' },
          targetAmount: { type: 'number', description: 'How much is being raised, as a plain number. Omit rather than guessing.' },
          preMoney: { type: 'number', description: 'Pre-money valuation being asked for.' },
          postMoney: { type: 'number', description: 'Post-money valuation.' },
          currency: { type: 'string' },
          leadInvestor: { type: 'string', description: 'The lead, once there is one. Never invent one.' },
          closeTargetAt: { type: 'string', description: 'ISO date the founder intends to close on. Bind a `trigger` with comparator "due-within" to it so the runway conversation happens while there is still runway.' },
          status: { type: 'string', enum: [...ROUND_STATUSES] },
          objectId: { type: 'string', description: 'The fundingRound card to refresh from the result.' },
        },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as Record<string, unknown>;
        const name = typeof args.name === 'string' ? args.name.trim() : '';
        if (!name) return { error: 'Name the round — "Seed 2026". The name is what its investor allocations join to, so it cannot be invented later.' };

        const result = await planFundingRound({
          name,
          ...(typeof args.roundType === 'string' ? { roundType: args.roundType } : {}),
          ...(typeof args.instrument === 'string' ? { instrument: args.instrument } : {}),
          ...(Number.isFinite(args.targetAmount) ? { targetAmount: Number(args.targetAmount) } : {}),
          ...(Number.isFinite(args.preMoney) ? { preMoney: Number(args.preMoney) } : {}),
          ...(Number.isFinite(args.postMoney) ? { postMoney: Number(args.postMoney) } : {}),
          ...(typeof args.currency === 'string' ? { currency: args.currency } : {}),
          ...(typeof args.leadInvestor === 'string' ? { leadInvestor: args.leadInvestor } : {}),
          ...(typeof args.closeTargetAt === 'string' ? { closeTargetAt: args.closeTargetAt } : {}),
          ...(typeof args.status === 'string' ? { status: args.status } : {}),
        });
        const boardUpdated = writeBoard(result.pipeline, typeof args.objectId === 'string' ? args.objectId : undefined, `Round planned — ${name}`);
        return {
          ok: true, proposed: true, round: result.round, boardUpdated, ...result.pipeline.totals,
          instruction: 'The plan is recorded and the board was redrawn from the same response. Add investors to it with canvas_open_deal using this exact round name. Never state how much has been raised from the plan — read it from the allocations.',
        };
      },
    },
    {
      name: 'canvas_open_deal',
      description:
        'Open a deal against a named counterparty, creating the counterparty in the workspace if it is new — an investor for a raise, a customer for a sale. This is how a firm becomes an OBJECT every other board can join to, rather than a name typed into a row. Use it whenever the user names a fund, angel or company that should be in the pipeline ("add Northwind to the seed round", "we are talking to Acme"). Never invent a firm, an amount or an introducer. Re-opening the same counterparty returns the existing deal rather than a duplicate.',
      parameters: {
        type: 'object', required: ['counterparty'], additionalProperties: false,
        properties: {
          family: { type: 'string', enum: ['sales', 'raise'], description: 'Which board. Defaults to sales; use `raise` for an investor.' },
          counterparty: { type: 'string', description: 'The firm or company by name — "Northwind Ventures". Real names only.' },
          name: { type: 'string', description: 'What the deal is called, if not just the counterparty.' },
          amount: { type: 'number', description: 'The amount discussed, as a plain number in the workspace currency. Omit rather than guessing.' },
          stage: { type: 'string', description: 'The stage to open it in. Must be one of the stages on the board. Omit for the first stage.' },
          pipelineRef: { type: 'string', description: 'The named round or pipeline this belongs to.' },
          introVia: { type: 'string', description: 'Who can make the introduction, when it is warm. Recorded on the deal AND as an `intro` entry in its thread.' },
          expectedCloseAt: { type: 'string', description: 'ISO date it is expected to close.' },
          objectId: { type: 'string', description: 'The board card to refresh from the result. Omit to reuse the one on the board.' },
        },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as {
          family?: 'sales' | 'raise'; counterparty?: string; name?: string; amount?: number;
          stage?: string; pipelineRef?: string; introVia?: string; expectedCloseAt?: string; objectId?: string;
        };
        if (!args.counterparty?.trim()) {
          return { error: 'Name the counterparty. A pipeline row with no party is a reminder, not a deal — ask the user for the firm\'s name rather than inventing one.' };
        }
        const family = args.family === 'raise' ? 'raise' : 'sales';
        const result = await openDeal({
          family,
          counterparty: args.counterparty,
          ...(args.name ? { name: args.name } : {}),
          ...(args.amount != null ? { amount: args.amount } : {}),
          ...(args.stage ? { stage: args.stage } : {}),
          ...(args.pipelineRef ? { pipelineRef: args.pipelineRef } : {}),
          ...(args.introVia ? { introVia: args.introVia } : {}),
          ...(args.expectedCloseAt ? { expectedCloseAt: args.expectedCloseAt } : {}),
        });
        const boardUpdated = writeBoard(result.pipeline, args.objectId, `${result.created ? 'Opened' : 'Updated'} ${args.counterparty}`);
        return {
          ok: true, proposed: true,
          dealId: result.dealId, partyRef: result.partyRef, created: result.created,
          boardUpdated, ...result.pipeline.totals,
          instruction: 'The counterparty and the deal are both real records now, and the board was redrawn from the same response. Do not call canvas_update_object to mirror this.',
        };
      },
    },
    {
      name: 'canvas_log_deal_touch',
      description:
        'Record a conversation on ONE deal — a call, an email, a meeting, an introduction. This is the per-counterparty thread: it is what makes "what happened with Northwind" answerable and what the board shows as each card\'s note. Use it whenever the user reports an interaction with a named firm. Never invent a conversation, and never summarise one the user did not describe.',
      parameters: {
        type: 'object', required: ['dealId', 'summary'], additionalProperties: false,
        properties: {
          dealId: { type: 'number', description: 'The canonical deal id from the card.' },
          summary: { type: 'string', description: 'What actually happened, in the user\'s own terms.' },
          channel: { type: 'string', enum: ['call', 'email', 'meeting', 'demo', 'intro', 'note'] },
          direction: { type: 'string', enum: ['outbound', 'inbound', 'internal'] },
          occurredAt: { type: 'string', description: 'ISO instant it happened. Omit for now.' },
          objectId: { type: 'string', description: 'The board card to refresh afterwards. Omit to reuse the one on the board.' },
        },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as { dealId?: number; summary?: string; channel?: string; direction?: string; occurredAt?: string; objectId?: string };
        if (!Number.isFinite(args.dealId)) return { error: 'Pass the numeric dealId carried on the card. Sync the board first if you do not have one.' };
        if (!args.summary?.trim()) return { error: 'Say what happened — a touch with no summary is a timestamp nobody can act on.' };

        const thread = await logDealTouch(Number(args.dealId), {
          summary: args.summary,
          ...(args.channel ? { channel: args.channel } : {}),
          ...(args.direction ? { direction: args.direction } : {}),
          ...(args.occurredAt ? { occurredAt: args.occurredAt } : {}),
        });
        // The note a card shows IS the latest touch, so the board is redrawn from
        // the projection rather than patched — one direction, as everywhere else here.
        const pipeline = await readPipeline({ family: 'raise' }).catch(() => null);
        const boardUpdated = pipeline ? writeBoard(pipeline, args.objectId, 'Conversation recorded') : false;
        return {
          ok: true, proposed: true, entries: thread.length, latest: thread[0] ?? null, boardUpdated,
          instruction: 'The conversation is recorded against the deal. Do not also author a note object for it.',
        };
      },
    },
    {
      name: 'canvas_move_deal',
      description:
        'Move a deal to a different stage — a sales deal or an investor allocation, whichever the deal is. This changes the DEAL in the record and rewrites the matching card on the board from the result, in one call — so never follow it with an update to the card, and never edit a pipeline or fundingRound row to record a stage change. Pass the `dealId` carried on the card (canvas_sync_sales_pipeline and canvas_sync_funding_round both put it there); if you do not have one, sync the board first rather than guessing.',
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
        // WHICH card is redrawn comes from the response's own family, which the
        // server read off the deal's `kind`. The caller never names the board — a
        // caller that could name it is a caller that could name the wrong one, and
        // an investor allocation redrawn onto the sales pipeline is exactly the
        // silent wrongness this projection exists to remove.
        const boardUpdated = writeBoard(pipeline, undefined, `Deal moved to ${args.stage}`);

        return {
          ok: true, proposed: true, movedTo: args.stage,
          family: pipeline.family, boardUpdated,
          ...pipeline.totals,
          instruction: 'The CRM and the board are both updated. Do not call canvas_update_object to mirror this.',
        };
      },
    },
  ];
}
