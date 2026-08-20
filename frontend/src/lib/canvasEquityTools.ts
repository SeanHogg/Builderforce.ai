/**
 * The canvas's OWNERSHIP vocabulary — the cap table, the grant, and the round.
 *
 * ── WHAT THESE CLOSE ────────────────────────────────────────────────────────
 * The `capTable` card was a hand-typed `holders` array whose own hint asked the
 * model to say so in `summary` when the percentages did not total 100 — an
 * object that documented its own inability to be right. The three tools here
 * replace the typing with a projection, the same way `canvas_move_deal` replaced
 * the mirroring instruction with a mechanism:
 *
 *  · `canvas_sync_cap_table` FOLDS the real ledger onto the card. Every figure
 *    it writes is computed from `equity_events`, so the percentages total 100
 *    because they are one division by one denominator.
 *  · `canvas_record_equity_grant` writes the grant AND its issuance event AND
 *    re-folds the board in one call. There is no "now update the cap table"
 *    step, because a step that can be forgotten is a step that will be.
 *  · `canvas_model_round` prices a round against what actually exists, converting
 *    every outstanding SAFE and note on its own cap and discount. It WRITES
 *    NOTHING to the ledger — a model that quietly recorded the round it was asked
 *    to imagine is the worst failure this family could have.
 *
 * ── WHY THERE IS NO "WRITE THE CAP TABLE" TOOL ──────────────────────────────
 * Because a cap table is not a set of numbers somebody agrees on. Offering one
 * would restore exactly the object this work deletes, and the model would use it:
 * it is the shorter path to a card that looks finished.
 */

import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { DEFAULT_LOCALE } from '@/i18n/config';
import { formatterFor } from '@/i18n/format';
import {
  ACCELERATION_KINDS,
  CONVERTIBLE_KINDS,
  EQUITY_EVENT_KINDS,
  EQUITY_INSTRUMENTS,
  VESTING_FREQUENCIES,
  partyRef,
} from '@builderforce/creation-canvas-contract';
import {
  applyRound,
  capTable,
  modelRound,
  recordConvertible,
  recordEquityEvent,
  recordEquityGrant,
  upsertShareClass,
  type CapTable,
  type RoundModel,
} from '@/lib/founderOpsApi';
import type { CanvasFounderOpsContext } from '@/lib/canvasFounderOpsTools';

/** Cap on grants authored in one sync. A board is a working surface; a company
 *  past this many certificates wants the entity browser, not more cards. */
const MAX_GRANT_CARDS = 40;

const NO_TENANT = 'This needs a signed-in, saved canvas session: ownership records live in the workspace, and an anonymous board has no workspace behind it. Say so in one sentence and author what this board can hold — never claim it ran.';

/**
 * Pinned to the default locale, NOT the reader's.
 *
 * Everything below writes PERSISTED canvas object data — English prose summaries
 * that a tool result and the next turn both read. A number that groups one way
 * for a German reader and another for an English one would make the stored value
 * depend on who happened to be looking at the board when it was computed.
 */
const fmt = formatterFor(DEFAULT_LOCALE);

const integer = (value: number): string => fmt.number(Math.round(value));

/** The `capTable` fields one projection writes. Every one is `derived` on the
 *  spec, so this function is the ONLY writer of them. */
export function capTableFieldsFrom(table: CapTable): Record<string, unknown> {
  return {
    companyRef: table.companyRef,
    asOf: table.asOf.slice(0, 10),
    status: table.eventCount ? 'live' : 'draft',
    issued: table.issued,
    fullyDiluted: table.fullyDiluted,
    poolAuthorized: table.poolAuthorized,
    poolUnallocated: table.poolUnallocated,
    holders: table.holders.map((holder) => ({
      holder: holder.holderName,
      shareClass: holder.shareClassName,
      instrument: holder.instrument,
      shares: holder.shares,
      vested: holder.vested,
      percent: holder.percentFullyDiluted,
    })),
    convertibles: table.convertibles.map((instrument) => ({
      reference: instrument.reference,
      holder: instrument.holderName,
      kind: instrument.kind,
      principal: instrument.principal,
      cap: instrument.valuationCap,
      discount: instrument.discountPercent,
    })),
    summary: table.eventCount
      ? `${integer(table.fullyDiluted)} shares fully diluted across ${table.holders.length} holding${table.holders.length === 1 ? '' : 's'}, `
        + `${integer(table.poolUnallocated)} unallocated in the pool`
        + (table.convertibles.length
          ? `, and ${table.convertibles.length} convertible${table.convertibles.length === 1 ? '' : 's'} worth ${integer(table.convertiblePrincipal)} still to price. `
          : '. ')
        + `Folded from ${integer(table.eventCount)} ledger event${table.eventCount === 1 ? '' : 's'} as of ${table.asOf.slice(0, 10)} — this card is a VIEW of the ledger, not a second copy, so change it by recording an event rather than by editing a row.`
      : 'No ownership events recorded for this company yet. Record the founders\' issuance first — every figure on this card is folded from the ledger, so an empty ledger means an empty table rather than a company owning nothing.'
      ,
    ...(table.poolOverAllocated
      ? { warning: 'More options have been granted than the pool authorises. That is a real condition, not a rounding error — the board has to authorise the difference.' }
      : {}),
  };
}

/** The `equityGrant` fields a projection writes for one holding. */
function grantFieldsFrom(
  holder: CapTable['holders'][number],
  companyRef: string,
): Record<string, unknown> {
  return {
    title: `${holder.holderName} · ${holder.shareClassName}`,
    reference: `${companyRef}:${holder.holderRef}:${holder.shareClassRef}`,
    holder: holder.holderName,
    shareClass: holder.shareClassName,
    instrument: holder.instrument,
    quantity: holder.shares,
    vested: holder.vested,
    status: holder.unvested > 0 ? 'vesting' : 'vested',
    summary: `${integer(holder.vested)} of ${integer(holder.shares)} vested — ${holder.percentFullyDiluted}% fully diluted. Projected from the ledger; record an event to change it.`,
  };
}

/** A round model, rendered onto the `fundingRound` card that asked for it. */
export function roundModelFieldsFrom(model: RoundModel): Record<string, unknown> {
  const converted = model.conversions.reduce((sum, row) => sum + row.shares, 0);
  return {
    valuation: model.postMoney,
    targetAmount: model.raiseAmount,
    modelledPricePerShare: model.pricePerShare,
    dilution: model.dilution.map((row) => ({
      holder: row.holderName,
      before: row.before,
      after: row.after,
    })),
    conversions: model.conversions.map((row) => ({
      instrument: row.reference,
      holder: row.holderName,
      basis: row.basis,
      price: row.conversionPrice,
      shares: row.shares,
    })),
    summary: model.postRoundFullyDiluted > 0
      ? `At ${integer(model.preMoney)} pre-money raising ${integer(model.raiseAmount)}, the price is ${model.pricePerShare.toFixed(4)} per share. `
        + `The new investor takes ${integer(model.newInvestorShares)} shares`
        + (model.poolIncrease ? `, the pool grows by ${integer(model.poolIncrease)}` : '')
        + (converted ? `, and ${integer(converted)} shares convert out of ${model.conversions.length} instrument${model.conversions.length === 1 ? '' : 's'}` : '')
        + `, for ${integer(model.postRoundFullyDiluted)} fully diluted afterwards. ${model.caveats.join(' ')}`
      : model.caveats.join(' '),
  };
}

export function canvasEquityActions(ctx: CanvasFounderOpsContext): BrainAction[] {
  const guard = (): { error: string } | null => {
    if (!ctx.hasTenant) return { error: NO_TENANT };
    if (!ctx.canEdit) return { error: 'The current session role cannot edit this canvas' };
    return null;
  };

  /** The company this board is about. Taken from a `capTable` or `company` card
   *  where one exists, so the model does not have to be told twice. */
  const boardCompanyRef = (given?: string): string => {
    if (given?.trim()) return partyRef(given);
    const objects = ctx.objects();
    const table = objects.find((object) => object.kind === 'capTable' && typeof object.data.companyRef === 'string' && object.data.companyRef);
    if (table) return partyRef(String(table.data.companyRef));
    const company = objects.find((object) => object.kind === 'company');
    return company ? partyRef(company.title) : '';
  };

  /** Fold the ledger onto the board's `capTable` card, creating it when absent.
   *  Shared by the sync tool and by the two writers, so a grant and a round both
   *  leave the board showing the table they just changed. */
  const projectOntoBoard = async (
    companyRef: string,
    asOf: string | undefined,
    at: { x?: number; y?: number },
  ): Promise<{ table: CapTable; objectId: string; created: boolean }> => {
    const table = await capTable(companyRef, asOf);
    const fields = capTableFieldsFrom(table);
    const existing = ctx.objects().find((object) => object.kind === 'capTable'
      && partyRef(String(object.data.companyRef ?? '')) === table.companyRef);
    if (existing) {
      ctx.updateObject(existing.id, fields, `Refreshed the cap table for ${table.companyRef}`);
      return { table, objectId: existing.id, created: false };
    }
    const { objectId } = ctx.addObject('capTable', { title: `Cap table · ${table.companyRef}`, ...fields }, at);
    return { table, objectId, created: true };
  };

  return [
    {
      name: 'canvas_sync_cap_table',
      description:
        'FOLD this workspace\'s real ownership ledger onto the canvas as a `capTable` object — who holds what, how much has vested, what is left in the option pool, and which SAFEs and notes are still outstanding. Call this whenever the user asks who owns the company, what their stake is, how much of the pool is left, or what a holder has vested; and BEFORE modelling a round, so the round is priced against something real. Every number it writes is COMPUTED from the ledger — never author a `capTable` yourself and never edit its rows, because a typed cap table is exactly the object this replaces. Pass `asOf` to ask a historical question ("what did we own in March"): that is a real answer from the same ledger, not a stale read. Optionally authors one `equityGrant` card per holding so a vesting schedule can be watched by a `trigger`.',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          companyRef: { type: 'string', description: 'Which company. Omit to use the `capTable` or `company` object already on this board.' },
          asOf: { type: 'string', description: 'ISO date to fold the ledger at. Omit for today.' },
          includeGrants: { type: 'boolean', description: 'Also author an `equityGrant` card per holding. Use it when the conversation is about vesting or a cliff.' },
          x: { type: 'number' }, y: { type: 'number' },
        },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as { companyRef?: string; asOf?: string; includeGrants?: boolean; x?: number; y?: number };
        const companyRef = boardCompanyRef(args.companyRef);
        if (!companyRef) {
          return {
            error: 'Which company? Name it in `companyRef`, or put a `company` object on this board first — a cap table with no company is a table of nothing.',
          };
        }

        const at = { ...(args.x != null ? { x: args.x } : {}), ...(args.y != null ? { y: args.y } : {}) };
        const { table, objectId, created } = await projectOntoBoard(companyRef, args.asOf, at);

        if (!table.eventCount) {
          return {
            ok: true, proposed: true, objectId, capTableFound: false,
            instruction: `This workspace has no ownership events for "${companyRef}" yet, so the card is honestly empty rather than showing zeroes. Record the founders' issuance with canvas_record_equity_grant — authorise a share class first if there is none. Do NOT type holders onto the card: they would not be in the ledger and every later number would be wrong.`,
          };
        }

        const grants = args.includeGrants
          ? table.holders.slice(0, MAX_GRANT_CARDS).map((holder) => {
            const fields = grantFieldsFrom(holder, table.companyRef);
            const match = ctx.objects().find((object) => object.kind === 'equityGrant' && object.data.reference === fields.reference);
            if (match) {
              ctx.updateObject(match.id, fields, `Refreshed ${fields.title}`);
              return { objectId: match.id, holder: holder.holderName, updated: true };
            }
            const added = ctx.addObject('equityGrant', fields);
            return { objectId: added.objectId, holder: holder.holderName, updated: false };
          })
          : [];

        return {
          ok: true, proposed: true, capTableFound: true,
          objectId, created,
          asOf: table.asOf,
          fullyDiluted: table.fullyDiluted,
          holders: table.holders.length,
          poolUnallocated: table.poolUnallocated,
          convertibles: table.convertibles.length,
          ...(grants.length ? { grants } : {}),
          ...(table.poolOverAllocated ? { poolOverAllocated: true } : {}),
          instruction: 'Report the folded numbers as they are. If the user wants a different total, the answer is a ledger EVENT, never an edit to this card.',
        };
      },
    },
    {
      name: 'canvas_record_equity_grant',
      description:
        'Record a real equity grant — the certificate, its vesting schedule, AND the issuance event that puts it on the cap table — then re-fold the board. One call: there is no separate "update the cap table" step to forget. Use it when the user says they granted, issued or promised shares or options to somebody, and when an offer\'s equity line needs to become a checkable fact rather than a sentence. Authorises the share class first when it does not exist yet. A grant with a `cliffMonths` gets a real cliff DATE on its card, which a `trigger` with comparator "due-within" can then watch — the first ownership date on this canvas that can warn before rather than report after.',
      parameters: {
        type: 'object', additionalProperties: false,
        required: ['reference', 'holderName', 'shareClassName', 'quantity'],
        properties: {
          companyRef: { type: 'string' },
          reference: { type: 'string', description: 'The certificate or grant number. Unique per company.' },
          holderName: { type: 'string' },
          shareClassName: { type: 'string', description: 'The class it comes out of — "Common", "Series A Preferred", "Option Pool". Authorised automatically when absent.' },
          shareClassKind: { type: 'string', enum: ['common', 'preferred', 'option-pool'] },
          shareClassAuthorized: { type: 'number', description: 'Shares authorised into the class, when authorising it here. Required for an option pool, whose unallocated figure is authorised minus granted.' },
          instrument: { type: 'string', enum: [...EQUITY_INSTRUMENTS] },
          quantity: { type: 'number', minimum: 1 },
          pricePerShare: { type: 'number' },
          fmvPerShare: { type: 'number' },
          grantedAt: { type: 'string', description: 'ISO date of the grant.' },
          vestingStartAt: { type: 'string', description: 'ISO date the vesting clock starts — usually a start date, not the grant date.' },
          vestingMonths: { type: 'number', description: 'Total schedule length. 48 is common and is not the only answer.' },
          cliffMonths: { type: 'number', description: 'Nothing vests until this many months pass, then that whole portion vests at once. 12 is standard.' },
          vestingFrequency: { type: 'string', enum: [...VESTING_FREQUENCIES] },
          acceleration: { type: 'string', enum: [...ACCELERATION_KINDS] },
          notes: { type: 'string' },
        },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as {
          companyRef?: string; reference: string; holderName: string; shareClassName: string;
          shareClassKind?: string; shareClassAuthorized?: number; instrument?: string; quantity: number;
          pricePerShare?: number; fmvPerShare?: number; grantedAt?: string; vestingStartAt?: string;
          vestingMonths?: number; cliffMonths?: number; vestingFrequency?: string; acceleration?: string; notes?: string;
        };
        const companyRef = boardCompanyRef(args.companyRef);
        if (!companyRef) return { error: 'Which company? Name it in `companyRef`, or put a `company` object on this board first.' };

        // Authorised first, always. A grant out of a class nobody authorised is
        // refused by the API, and refusing it here with a second round-trip would
        // be the same answer twice — so the class is ensured instead.
        const { classRef } = await upsertShareClass({
          companyRef,
          name: args.shareClassName,
          kind: args.shareClassKind ?? (args.instrument === 'option' || args.instrument === 'rsu' ? 'option-pool' : 'common'),
          ...(args.shareClassAuthorized != null ? { authorized: args.shareClassAuthorized } : {}),
          ...(args.pricePerShare != null ? { pricePerShare: args.pricePerShare } : {}),
        });

        const grant = await recordEquityGrant({
          companyRef,
          reference: args.reference,
          shareClassRef: classRef,
          holderName: args.holderName,
          instrument: args.instrument ?? 'common',
          quantity: args.quantity,
          pricePerShare: args.pricePerShare ?? null,
          fmvPerShare: args.fmvPerShare ?? null,
          grantedAt: args.grantedAt ?? null,
          vestingStartAt: args.vestingStartAt ?? null,
          vestingMonths: args.vestingMonths ?? null,
          cliffMonths: args.cliffMonths ?? null,
          vestingFrequency: args.vestingFrequency ?? 'none',
          acceleration: args.acceleration ?? 'none',
          notes: args.notes ?? null,
        });

        const { table, objectId } = await projectOntoBoard(companyRef, undefined, {});
        const holding = table.holders.find((holder) => holder.holderRef === partyRef(args.holderName));

        // The grant's OWN card, so the schedule and its cliff are watchable. The
        // cliff date comes from the server's computation of the same schedule the
        // card shows, never from a second calculation here.
        const grantFields = {
          title: `${args.holderName} · ${args.shareClassName}`,
          reference: args.reference,
          holder: args.holderName,
          shareClass: args.shareClassName,
          instrument: args.instrument ?? 'common',
          quantity: args.quantity,
          vested: holding?.vested ?? 0,
          vestingStartAt: args.vestingStartAt ?? null,
          vestingMonths: args.vestingMonths ?? null,
          cliffMonths: args.cliffMonths ?? null,
          vestingFrequency: args.vestingFrequency ?? 'none',
          acceleration: args.acceleration ?? 'none',
          cliffAt: grant.cliffAt,
          pricePerShare: args.pricePerShare ?? null,
          fmvPerShare: args.fmvPerShare ?? null,
          status: (holding?.unvested ?? 0) > 0 ? 'vesting' : 'vested',
          summary: `Grant ${args.reference}: ${integer(args.quantity)} ${args.instrument ?? 'common'} to ${args.holderName}.`
            + (grant.cliffAt ? ` Cliff lands ${grant.cliffAt} — bind a \`trigger\` with "due-within" to it.` : ''),
        };
        const existingGrant = ctx.objects().find((object) => object.kind === 'equityGrant' && object.data.reference === args.reference);
        const grantObjectId = existingGrant
          ? (ctx.updateObject(existingGrant.id, grantFields, `Refreshed grant ${args.reference}`), existingGrant.id)
          : ctx.addObject('equityGrant', grantFields).objectId;

        return {
          ok: true, proposed: true,
          grantId: grant.grantId,
          eventId: grant.eventId,
          cliffAt: grant.cliffAt,
          grantObjectId,
          capTableObjectId: objectId,
          fullyDiluted: table.fullyDiluted,
          instruction: grant.cliffAt
            ? `Recorded, and the cap table has been re-folded. The cliff lands ${grant.cliffAt} — offer to bind a \`trigger\` with comparator "due-within" to that date so the conversation happens before it rather than after.`
            : 'Recorded, and the cap table has been re-folded.',
        };
      },
    },
    {
      name: 'canvas_record_convertible',
      description:
        'Record a SAFE or a convertible note against this company — principal, valuation cap, discount, and whether the SAFE is pre- or post-money. Use it when the user mentions raising on a SAFE or a note, or asks what their existing SAFEs will do at a priced round. The pre/post-money distinction is DECISIVE and not cosmetic: on a post-money SAFE the holder\'s percentage is fixed and the founders absorb every other SAFE\'s dilution, so if the user has not said which it is, ASK rather than assuming — guessing it misstates who ends up owning the company.',
      parameters: {
        type: 'object', additionalProperties: false,
        required: ['reference', 'holderName', 'principal'],
        properties: {
          companyRef: { type: 'string' },
          reference: { type: 'string' },
          kind: { type: 'string', enum: [...CONVERTIBLE_KINDS] },
          holderName: { type: 'string' },
          principal: { type: 'number', minimum: 1 },
          valuationCap: { type: 'number', description: 'Omit entirely for an uncapped instrument — never write a very large number, because uncapped and capped-high convert differently.' },
          discountPercent: { type: 'number', minimum: 0, maximum: 99 },
          postMoney: { type: 'boolean', description: 'true for a post-money SAFE (the 2018 YC form). Ask rather than guess.' },
          interestRate: { type: 'number', description: 'Simple annual interest, notes only. A SAFE does not accrue.' },
          issuedAt: { type: 'string' },
          maturesAt: { type: 'string', description: 'ISO date a note falls due. A SAFE has none.' },
          x: { type: 'number' }, y: { type: 'number' },
        },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as {
          companyRef?: string; reference: string; kind?: string; holderName: string; principal: number;
          valuationCap?: number; discountPercent?: number; postMoney?: boolean; interestRate?: number;
          issuedAt?: string; maturesAt?: string; x?: number; y?: number;
        };
        const companyRef = boardCompanyRef(args.companyRef);
        if (!companyRef) return { error: 'Which company? Name it in `companyRef`, or put a `company` object on this board first.' };

        await recordConvertible({
          companyRef,
          reference: args.reference,
          kind: args.kind ?? 'safe',
          holderName: args.holderName,
          principal: args.principal,
          valuationCap: args.valuationCap ?? null,
          discountPercent: args.discountPercent ?? null,
          postMoney: args.postMoney !== false,
          interestRate: args.interestRate ?? null,
          issuedAt: args.issuedAt ?? null,
          maturesAt: args.maturesAt ?? null,
        });

        const fields = {
          title: `${args.holderName} · ${(args.kind ?? 'safe').toUpperCase()}`,
          reference: args.reference,
          instrumentKind: args.kind ?? 'safe',
          holder: args.holderName,
          principal: args.principal,
          valuationCap: args.valuationCap ?? null,
          discountPercent: args.discountPercent ?? null,
          postMoney: args.postMoney !== false,
          interestRate: args.interestRate ?? null,
          maturesAt: args.maturesAt ?? null,
          status: 'outstanding',
          summary: `${integer(args.principal)} on a ${args.postMoney !== false ? 'post-money' : 'pre-money'} ${args.kind ?? 'safe'}`
            + (args.valuationCap ? ` capped at ${integer(args.valuationCap)}` : ' with no cap')
            + (args.discountPercent ? `, ${args.discountPercent}% discount` : '')
            + '. What it converts into is decided by the round that prices it — model that rather than estimating it.',
        };
        const existing = ctx.objects().find((object) => object.kind === 'convertible' && object.data.reference === args.reference);
        const objectId = existing
          ? (ctx.updateObject(existing.id, fields, `Refreshed ${args.reference}`), existing.id)
          : ctx.addObject('convertible', fields, { ...(args.x != null ? { x: args.x } : {}), ...(args.y != null ? { y: args.y } : {}) }).objectId;

        const { table } = await projectOntoBoard(companyRef, undefined, {});
        return {
          ok: true, proposed: true, objectId,
          outstandingConvertibles: table.convertibles.length,
          instruction: 'Recorded. It is NOT in the cap table percentages and must never be added to them — a convertible becomes shares only when a round prices it.',
        };
      },
    },
    {
      name: 'canvas_model_round',
      description:
        'Model a priced round against this company\'s REAL cap table — the price per share, the new investor\'s stake, the option-pool top-up, every outstanding SAFE and note converted on its own cap or discount, and each existing holder\'s ownership before and after. Call this whenever the user asks what a raise would do to their ownership, what a term sheet means, or what their SAFEs convert into. By default it WRITES NOTHING: it answers the question. Pass `apply: true` ONLY when the user has explicitly said the round has closed and should be recorded — that issues real shares and converts real instruments, and it is not reversible by re-modelling.',
      parameters: {
        type: 'object', additionalProperties: false,
        required: ['preMoney', 'raiseAmount'],
        properties: {
          companyRef: { type: 'string' },
          preMoney: { type: 'number', minimum: 0 },
          raiseAmount: { type: 'number', minimum: 0 },
          targetPoolPercent: { type: 'number', minimum: 0, maximum: 90, description: 'Post-round unallocated pool as a percent of fully diluted — the "pool shuffle" in a term sheet. The top-up lands BEFORE the new money prices, so it dilutes existing holders and not the investor. Say so when reporting.' },
          shareClassName: { type: 'string', description: 'The class the new money buys, e.g. "Series A Preferred". Required when applying.' },
          apply: { type: 'boolean', description: 'Record the round as real events. Only with an explicit instruction that it has closed.' },
          asOf: { type: 'string' },
        },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as {
          companyRef?: string; preMoney: number; raiseAmount: number; targetPoolPercent?: number;
          shareClassName?: string; apply?: boolean; asOf?: string;
        };
        const companyRef = boardCompanyRef(args.companyRef);
        if (!companyRef) return { error: 'Which company? Name it in `companyRef`, or put a `company` object on this board first.' };
        if (args.apply && !args.shareClassName?.trim()) {
          return { error: 'Applying a round needs the name of the class the new money buys — "Series A Preferred". Ask the user rather than inventing one.' };
        }

        const body = {
          companyRef,
          preMoney: args.preMoney,
          raiseAmount: args.raiseAmount,
          targetPoolPercent: args.targetPoolPercent ?? null,
          asOf: args.asOf ?? null,
        };
        const applied = args.apply ? await applyRound({ ...body, shareClassName: args.shareClassName as string }) : null;
        const model = applied ? applied.model : await modelRound(body);

        // Written onto the `fundingRound` this board already has, where one does,
        // because a model belongs beside the raise it is about rather than on a
        // card of its own that nothing else references.
        const fields = roundModelFieldsFrom(model);
        const round = ctx.objects().find((object) => object.kind === 'fundingRound');
        let roundObjectId: string;
        if (round) {
          ctx.updateObject(round.id, fields, 'Modelled the round against the real cap table');
          roundObjectId = round.id;
        } else {
          roundObjectId = ctx.addObject('fundingRound', {
            title: args.shareClassName?.trim() || 'Priced round',
            roundType: 'priced',
            ...fields,
          }).objectId;
        }

        // Applying moves the ledger, so the table on the board must move with it —
        // in the same call, for the same reason the grant tool re-folds.
        if (applied) await projectOntoBoard(companyRef, undefined, {});

        return {
          ok: true, proposed: true,
          applied: !!applied,
          roundObjectId,
          pricePerShare: model.pricePerShare,
          newInvestorShares: model.newInvestorShares,
          poolIncrease: model.poolIncrease,
          conversions: model.conversions,
          postRoundFullyDiluted: model.postRoundFullyDiluted,
          dilution: model.dilution,
          caveats: model.caveats,
          ...(applied ? { eventsRecorded: applied.eventsRecorded } : {}),
          instruction: applied
            ? 'The round is RECORDED — real shares issued and real instruments converted. Report what changed and by how much.'
            : 'Nothing has been recorded: this is a model. Lead with each existing holder\'s before-and-after percentage, and state every caveat returned — they are the assumptions the numbers depend on, not footnotes.',
        };
      },
    },
    {
      name: 'canvas_record_equity_event',
      description:
        `Append one ownership EVENT to the ledger — ${EQUITY_EVENT_KINDS.join(', ')} — and re-fold the cap table on this board. This is how ownership changes: a departure returns unvested options with a cancel, a secondary sale is a transfer, a buy-back is a repurchase, exercising options is an exercise, and topping up the pool is a pool-increase. Use it instead of editing any number on the \`capTable\` card, which is a projection and cannot be edited. Quantities are always POSITIVE — a reversal is its own event, never a negative one.`,
      parameters: {
        type: 'object', additionalProperties: false,
        required: ['eventKind', 'quantity'],
        properties: {
          companyRef: { type: 'string' },
          eventKind: { type: 'string', enum: [...EQUITY_EVENT_KINDS] },
          shareClassName: { type: 'string', description: 'The class the shares LEAVE, or the only class involved.' },
          toShareClassName: { type: 'string', description: 'The class they ARRIVE in when it differs — an exercise moves options out of the pool and common in.' },
          fromHolder: { type: 'string', description: 'Who loses the shares. Required for cancel, repurchase, transfer and exercise.' },
          toHolder: { type: 'string', description: 'Who gains them. Required for issue, transfer, exercise and conversion.' },
          quantity: { type: 'number', minimum: 1 },
          pricePerShare: { type: 'number' },
          effectiveAt: { type: 'string', description: 'ISO date it took EFFECT — not the date it is being recorded. Back-dating a real March event recorded in May is normal and correct.' },
          reason: { type: 'string', description: 'Why, in the words of whoever is recording it. The ledger is read by people.' },
        },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as {
          companyRef?: string; eventKind: string; shareClassName?: string; toShareClassName?: string;
          fromHolder?: string; toHolder?: string; quantity: number; pricePerShare?: number;
          effectiveAt?: string; reason?: string;
        };
        const companyRef = boardCompanyRef(args.companyRef);
        if (!companyRef) return { error: 'Which company? Name it in `companyRef`, or put a `company` object on this board first.' };

        const event = await recordEquityEvent({
          companyRef,
          eventKind: args.eventKind,
          shareClassRef: args.shareClassName ? partyRef(args.shareClassName) : null,
          toShareClassRef: args.toShareClassName ? partyRef(args.toShareClassName) : null,
          fromHolderRef: args.fromHolder ? partyRef(args.fromHolder) : null,
          toHolderRef: args.toHolder ? partyRef(args.toHolder) : null,
          quantity: args.quantity,
          pricePerShare: args.pricePerShare ?? null,
          effectiveAt: args.effectiveAt ?? null,
          reason: args.reason ?? null,
        });

        const { table, objectId } = await projectOntoBoard(companyRef, undefined, {});
        return {
          ok: true, proposed: true,
          eventId: event.id,
          capTableObjectId: objectId,
          fullyDiluted: table.fullyDiluted,
          poolUnallocated: table.poolUnallocated,
          instruction: 'Recorded and re-folded. Report the table as it now stands.',
        };
      },
    },
  ];
}
