/**
 * THE approval gate, and the provenance record behind it.
 *
 * ── TWO REVIEWS FOUND THE SAME HOLE FROM OPPOSITE SIDES ──────────────────────────
 * The CMO review: `emailCampaign.send`, `socialCampaign.publish` and `website.publish`
 * are direct-fire, irreversible, outbound actions with no reviewer — while `workflow`
 * alone supports `approvalMode: 'required'`. Everything that leaves the building is the
 * one thing that cannot be reviewed, so a CMO cannot delegate the canvas to an agent.
 *
 * The CFO review: nothing records who approved a FIGURE, when it changed, or from what.
 * `decision` records why a *choice* was made; `canvasActionJournal` is board history, not
 * an attributable per-field record. So a board pack sourced from the canvas cannot
 * survive "who signed off on this, and where did it come from?" — the one property a
 * finance output is judged on.
 *
 * They are one gap: an ACT that needs authority before it takes effect. Building two
 * gates would be the duplication [[no-technical-debt-rule]] forbids, and would let the
 * outbound gate and the money gate disagree about what "approved" means. So this module
 * is the single primitive, and the two surfaces differ only in which acts they declare.
 *
 * ── WHY PROVENANCE AND APPROVAL ARE THE SAME MODULE ─────────────────────────────
 * An approval that does not say WHAT was approved is decoration. The record a reviewer
 * signs is `{field, from, to}` — so the provenance entry IS the approval request, and
 * granting it stamps the same entry rather than writing a second one somewhere else.
 * That is what makes the trail defensible: there is no way to have an approval without
 * the change it approved, or a change with an approval that was for something else.
 *
 * ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────────
 * It does not enforce anything by itself. It is a pure decision function, so it is
 * unit-testable as a table and can be read by the node body, the tool layer and the
 * export runner without any of them reaching for a store. The CALLERS enforce; this
 * decides. `canvasScopePolicy.ts` draws the same line for the same reason.
 */

import { DEFAULT_LOCALE } from '@/i18n/config';
import { formatterFor } from '@/i18n/format';

/** What an act needs before it takes effect. */
export type ApprovalMode =
  /** Anyone who can edit the board may do it. The default for reversible work. */
  | 'open'
  /** A named approver must grant it first. */
  | 'required'
  /** Explicitly delegated to an agent — recorded, not reviewed. */
  | 'autonomous';

export const APPROVAL_MODES: readonly ApprovalMode[] = ['open', 'required', 'autonomous'];

/**
 * Acts that are IRREVERSIBLE or ATTESTED, keyed by object kind.
 *
 * Registry data rather than a branch per kind, so a new object kind is covered the
 * moment it is declared — the same open/closed rule the object registry follows.
 *
 * Two categories, and the distinction is the point:
 *  • OUTBOUND — the act leaves the building. Recalling it is impossible or embarrassing:
 *    a send, a publish, a payment.
 *  • ATTESTED — the act does not leave the building, but someone will later rely on the
 *    number as if a human stood behind it. A budget that was "approved" by nobody is the
 *    same defect as an email sent by nobody, one step further from the blast radius.
 */
export const GATED_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  // Outbound — the CMO half.
  emailCampaign: ['send'],
  socialCampaign: ['publish'],
  website: ['publish'],
  investorUpdate: ['send'],
  dataRoom: ['share'],
  // Attested — the CFO half. Approving a budget, authorising a bill and issuing an
  // invoice are the three acts a finance function exists to control, and all three were
  // one click with no reviewer and no record.
  budget: ['approve'],
  bill: ['approve', 'schedule-payment'],
  // All three of the receivable's acts, not only `issue`. `record-payment` is
  // ATTESTED — somebody will later rely on "this was paid" as if a human stood
  // behind it, and an invoice marked settled by nobody is the same defect as a
  // budget approved by nobody. `chase` is OUTBOUND: it emails a real customer in
  // the tenant's name, which is the same shape of act as `investorUpdate.send`.
  // Only `issue` was listed, so two of the three could be fired by a model with
  // no reviewer and no record.
  invoice: ['issue', 'record-payment', 'chase'],
  headcountPlan: ['approve'],
  // `capTable.sync` is deliberately NOT gated: folding the ledger onto the card
  // asserts nothing new and refusing to let a person LOOK at their own ownership
  // without an approval is not a control. `model` is gated because the same tool
  // can be told to APPLY the round it modelled, which issues real shares.
  capTable: ['model'],
  // Issuing equity is the most irreversible act in the whole vocabulary — it
  // changes who owns the company and cannot be undone by editing a card, only by
  // a further event that everybody involved has to agree to. `sync` stays open
  // for the same reason `capTable.sync` does.
  equityGrant: ['issue'],
  // Recording a convertible commits the company to future dilution on terms
  // nobody else can see from the card; `model` is the round-modelling act again.
  convertible: ['record', 'model'],
  fundingRound: ['track'],
  contract: ['sign'],
  // An offer letter leaving the building is the same shape of act as an investor
  // update or a data-room share — see the GATED_ACTIONS header. `offer.sign` is
  // deliberately absent: it only re-reads a request `send` already created and
  // asserts nothing new, so gating it would ask a human to approve a status refresh.
  offer: ['send'],
  // A `legalDocument`'s `share` mints a link an external party can read the real
  // file through with no Builderforce account, and `request-signature` emails a
  // counterparty — the same outbound shape as `dataRoom.share` and `contract.sign`.
  // `upload` and `sync` stay open: uploading and refreshing expose nothing new.
  legalDocument: ['share', 'request-signature'],
  // ── The sell motion ────────────────────────────────────────────────────────────
  // Every act here reaches a person OUTSIDE the tenant, which is the whole test this
  // list applies. A quote `send`/`share` puts a priced, acceptable offer in a buyer's
  // hands — the same shape as `contract.sign`, with money on it. A sequence `start`
  // begins an automated multi-channel send to real people and `enrol` adds more of them,
  // so both are gated while `stop` deliberately is NOT: a control that needs approval to
  // stop is not a safety control. A `trial.provision` creates a real workspace for
  // somebody outside the tenant, `invite` emails them into it, and `extend` moves an
  // expiry a buyer is planning around. A `trustPacket.share` publishes this workspace's
  // own security posture; `assemble`/`answer` only read internal evidence and stay open.
  // A `mutualActionPlan.handoff` writes a board into the customer's workspace.
  quote: ['send', 'share'],
  sequence: ['start', 'enrol'],
  call: ['share'],
  trial: ['provision', 'invite', 'extend'],
  trustPacket: ['share'],
  mutualActionPlan: ['share', 'handoff'],
};

/** True when this act on this kind may not simply be performed. */
export function actionIsGated(kind: string, action: string): boolean {
  return (GATED_ACTIONS[kind] ?? []).includes(action);
}

/**
 * FIELDS whose value is load-bearing enough that a change to it is worth attributing.
 *
 * Not every field: attributing a `summary` edit would bury the three changes that matter
 * under two hundred that do not, and a trail nobody reads is not a control. These are
 * the amounts a report quotes and a reviewer is accountable for.
 */
export const ATTRIBUTED_FIELDS: Readonly<Record<string, readonly string[]>> = {
  budget: ['plannedTotal', 'lines', 'period', 'currency'],
  forecast: ['runwayMonths', 'drivers', 'scenarios', 'periods'],
  // `contractRef` and `obligationRef` are attributed for the same reason `capTable.
  // companyRef` is: they are the JOIN. Re-pointed silently, a charge is checked against
  // a different agreement's terms and passes — which is the one way FO-G2's binding can
  // be made to lie without any figure on the card changing.
  invoice: ['amount', 'paidAmount', 'dueAt', 'lineItems', 'contractRef', 'obligationRef'],
  bill: ['amount', 'dueAt', 'approvedBy', 'contractRef', 'obligationRef'],
  headcountPlan: ['annualCost', 'roles', 'loadingRate'],
  // The cap table's own figures are a PROJECTION as of 0927 and cannot be edited
  // at all, so the only thing left worth attributing is the JOIN — which company
  // this card claims to be the ownership of. Getting that wrong points a board at
  // the wrong ledger, which is the one remaining way to make this card lie.
  capTable: ['companyRef'],
  // A grant's schedule IS the agreement. `vestingStartAt` moved by a month is a
  // month of somebody's equity, and it is the field most plausibly changed by
  // accident.
  equityGrant: ['quantity', 'vestingStartAt', 'vestingMonths', 'cliffMonths', 'acceleration'],
  convertible: ['principal', 'valuationCap', 'discountPercent', 'postMoney'],
  fundingRound: ['targetAmount', 'committed', 'valuation', 'useOfFunds'],
  pricing: ['tiers', 'grossMargin', 'unitEconomics'],
  // `reference` joined the list with FO-G2: it is the identity every invoice and bill
  // points at, so editing it orphans every document raised under this agreement at once
  // — a bigger silent change than any figure on the card.
  contract: ['valueAmount', 'renewsAt', 'obligations', 'reference'],
  liveMetric: ['target'],
  role: ['salary', 'loadedCost', 'startAt'],
  // The priced deal itself. A discount changed after a buyer has seen the quote is the
  // single most consequential silent edit in the whole vocabulary, and `lines` carries it.
  quote: ['lines', 'termMonths', 'expiresAt'],
  trial: ['expiresAt'],
};

export function fieldIsAttributed(kind: string, field: string): boolean {
  return (ATTRIBUTED_FIELDS[kind] ?? []).includes(field);
}

/** Who did something. `kind` matters more than `ref`: an agent edit is not a human one. */
export interface Actor {
  kind: 'human' | 'agent' | 'brain' | 'system';
  ref: string;
  name?: string;
}

/**
 * One attributable change to one field.
 *
 * `from`/`to` are stored as display strings rather than the raw values: the record has
 * to be readable a year later by someone who does not have the object in front of them,
 * and a serialized 200-row table in a ledger entry is not a record anybody reads.
 */
export interface ProvenanceEntry {
  id: string;
  field: string;
  from: string;
  to: string;
  at: string;
  by: Actor;
  /** Where the new value came from: a connector, a document, a calculation, a person. */
  source?: string;
  /** Set once the change is approved. An entry with none is a change nobody stands behind. */
  approvedBy?: Actor;
  approvedAt?: string;
}

const MAX_SUMMARY = 160;

/**
 * Pinned to the default locale, NOT the reader's.
 *
 * Everything below writes PERSISTED canvas object data — English prose a tool
 * result and the next turn both read. A number that groups one way for a German
 * reader and another for an English one would make the stored value depend on
 * who happened to be looking at the board when it was computed.
 */
const fmt = formatterFor(DEFAULT_LOCALE);


/** A value as it will read in a ledger a year from now. */
export function describeValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'number') return fmt.number(value);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) return `${value.length} row${value.length === 1 ? '' : 's'}`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.amount === 'number') return `${fmt.number(record.amount)}${record.currency ? ` ${record.currency}` : ''}`;
    return `${Object.keys(record).length} field${Object.keys(record).length === 1 ? '' : 's'}`;
  }
  const text = String(value).trim();
  return text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY - 1)}…` : text;
}

export function readProvenance(data: Record<string, unknown>): ProvenanceEntry[] {
  const raw = data.provenance;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const entry = item as Record<string, unknown>;
    const field = typeof entry.field === 'string' ? entry.field : '';
    const at = typeof entry.at === 'string' ? entry.at : '';
    if (!field || !at) return [];
    const by = normalizeActor(entry.by);
    if (!by) return [];
    const approvedBy = normalizeActor(entry.approvedBy);
    return [{
      id: typeof entry.id === 'string' && entry.id ? entry.id : `${field}:${at}`,
      field,
      from: typeof entry.from === 'string' ? entry.from : '—',
      to: typeof entry.to === 'string' ? entry.to : '—',
      at,
      by,
      ...(typeof entry.source === 'string' && entry.source.trim() ? { source: entry.source.trim().slice(0, 200) } : {}),
      ...(approvedBy ? { approvedBy } : {}),
      ...(typeof entry.approvedAt === 'string' && entry.approvedAt ? { approvedAt: entry.approvedAt } : {}),
    }];
  }).slice(-200);
}

function normalizeActor(value: unknown): Actor | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const kind = ['human', 'agent', 'brain', 'system'].includes(String(raw.kind)) ? raw.kind as Actor['kind'] : null;
  const ref = typeof raw.ref === 'string' ? raw.ref.trim() : '';
  if (!kind || !ref) return null;
  return { kind, ref, ...(typeof raw.name === 'string' && raw.name.trim() ? { name: raw.name.trim().slice(0, 80) } : {}) };
}

/**
 * The provenance entries a patch would produce.
 *
 * Called with the object BEFORE and the authored patch, so it can name what actually
 * moved rather than restating what was sent. A patch that re-sends an identical value
 * produces nothing: a ledger full of no-op entries is how a real change gets lost.
 */
export function provenanceForPatch(
  kind: string,
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
  by: Actor,
  at: string,
  source?: string,
): ProvenanceEntry[] {
  return Object.entries(patch).flatMap(([field, next]) => {
    if (!fieldIsAttributed(kind, field)) return [];
    const from = describeValue(before[field]);
    const to = describeValue(next);
    if (from === to) return [];
    return [{
      id: `${field}:${at}`,
      field,
      from,
      to,
      at,
      by,
      ...(source ? { source } : {}),
    }];
  });
}

/** Merge new entries onto an object's existing trail, newest last, bounded. */
export function appendProvenance(data: Record<string, unknown>, entries: readonly ProvenanceEntry[]): ProvenanceEntry[] {
  return [...readProvenance(data), ...entries].slice(-200);
}

// ── The gate ──────────────────────────────────────────────────────────────────────

export type GateVerdict =
  /** Perform it. */
  | { allowed: true; reason: 'open' | 'approved' | 'autonomous' }
  /** Do not perform it; `message` is what the model or the user is told. */
  | { allowed: false; reason: 'awaiting-approval' | 'self-approval' | 'not-permitted'; message: string };

export interface GateRequest {
  kind: string;
  action: string;
  /** The object's declared mode. Defaults to `required` for a gated act. */
  mode?: ApprovalMode;
  /** Who is trying to perform it. */
  actor: Actor;
  /** The object's current provenance trail. */
  provenance?: readonly ProvenanceEntry[];
  /** True when the workspace permits agents to self-approve this class of act. */
  agentsMayApprove?: boolean;
}

/**
 * Decide whether one act may proceed.
 *
 * ── THE TWO RULES THAT DO THE WORK ──────────────────────────────────────────────
 * 1. A gated act DEFAULTS to `required`. An object that never declared a mode is not
 *    thereby unrestricted — defaulting to open would mean the gate protects only the
 *    boards whose author already thought about it, which is exactly the boards that did
 *    not need protecting.
 *
 * 2. AN AGENT MAY NOT APPROVE ITS OWN CHANGE. `autonomous` is a human's standing
 *    delegation, so an agent running under it proceeds and is RECORDED; but an agent
 *    presented with `required` cannot satisfy it by stamping itself, because an
 *    approval an agent granted to an agent is not review, it is a second copy of the
 *    same judgement. This is the rule that makes "delegate the canvas to an agent"
 *    safe enough to offer.
 */
export function evaluateGate(request: GateRequest): GateVerdict {
  if (!actionIsGated(request.kind, request.action)) return { allowed: true, reason: 'open' };

  const mode = request.mode ?? 'required';

  if (mode === 'open') return { allowed: true, reason: 'open' };

  if (mode === 'autonomous') {
    // A standing delegation covers an agent and, trivially, a human. It is recorded by
    // the caller as `autonomous` so a reader can tell a delegated act from a reviewed one.
    return { allowed: true, reason: 'autonomous' };
  }

  const pending = (request.provenance ?? []).filter((entry) => !entry.approvedBy);
  if (!pending.length) {
    // Nothing outstanding to approve: the act is a fresh one, so it needs authority now.
    return {
      allowed: false,
      reason: 'awaiting-approval',
      message: gateMessage(request.kind, request.action, 0),
    };
  }

  const approver = request.actor;
  const isAgent = approver.kind === 'agent' || approver.kind === 'brain';
  if (isAgent && !request.agentsMayApprove) {
    return {
      allowed: false,
      reason: 'self-approval',
      message: `"${request.action}" on this ${request.kind} needs a human approver. An agent cannot approve its own change — set the object's approval mode to "autonomous" if this act is genuinely delegated, and it will proceed and be recorded as delegated rather than reviewed.`,
    };
  }

  const authored = pending.filter((entry) => entry.by.ref === approver.ref);
  if (authored.length === pending.length && approver.kind === 'human') {
    return {
      allowed: false,
      reason: 'self-approval',
      message: `Every pending change on this ${request.kind} was made by ${approver.name ?? approver.ref}, so approving it would be self-approval. Ask a second person to approve, or set the approval mode to "open" if this object does not need separation of duties.`,
    };
  }

  return { allowed: true, reason: 'approved' };
}

function gateMessage(kind: string, action: string, pending: number): string {
  const scope = pending ? `${pending} pending change${pending === 1 ? '' : 's'}` : 'this change';
  return `"${action}" on a ${kind} is a gated act: it is irreversible or someone will rely on it as attested, so ${scope} must be approved by a named person first. Record the approval on the object (approvedBy/approvedAt) and then perform the act — do NOT perform it and describe it as approved.`;
}

/** Stamp every unapproved entry as approved. The act the gate was waiting for. */
export function grantApproval(
  entries: readonly ProvenanceEntry[],
  approver: Actor,
  at: string,
): ProvenanceEntry[] {
  return entries.map((entry) => (entry.approvedBy ? entry : { ...entry, approvedBy: approver, approvedAt: at }));
}

/** Changes still waiting on a signature — what the card badge counts. */
export function pendingApprovals(data: Record<string, unknown>): ProvenanceEntry[] {
  return readProvenance(data).filter((entry) => !entry.approvedBy);
}

/**
 * Model-facing documentation, generated from the registries above.
 *
 * Written from the data rather than restated in a prompt paragraph, so the gate the
 * model is told about and the gate the code enforces cannot drift — the same contract
 * `check-prompt-tool-names.mjs` holds for tool names.
 */
export function approvalGuidance(): string {
  const gated = Object.entries(GATED_ACTIONS)
    .map(([kind, actions]) => `${kind}: ${actions.join(', ')}`)
    .join(' · ');
  return [
    'GATED ACTIONS. These acts are irreversible, or someone will later rely on them as if a human stood behind them, so they need a named approver before they take effect:',
    gated + '.',
    'Never perform one and then describe it as approved. Author the change, say plainly that it is waiting on approval and who should give it, and stop there.',
    'Changes to money-bearing fields are recorded with who made them and what they moved from — never overwrite a figure without saying what it was.',
  ].join(' ');
}
