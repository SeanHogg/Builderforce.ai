/**
 * THE legal-document specification — one declaration for the `legalDocument` kind,
 * read by everything, following the mechanism `founderObjects.ts` and
 * `hiringObjects.ts` already prove out.
 *
 * ── THE BACKEND THIS IS THE FRONT OF ─────────────────────────────────────────────
 * `api/src/application/legal/legalDocumentStore.ts` — an encrypted `legal_document_
 * files` row, versioned by re-pointing `currentArtifactId` rather than overwriting,
 * with `status`/`signedAt` DERIVED at read time from `legal_document_shares` and the
 * `signature_requests` row `signatureRequestId` points at. Nothing on this card is
 * stored redundantly with that derivation — see the fields below.
 *
 * ── EVERY FIELD HERE IS BOOKKEEPING, ON PURPOSE ──────────────────────────────────
 * Unlike a founder object (a `competitor` a model researches and writes), a
 * `legalDocument` card describes a REAL uploaded file and the real, external events
 * that happened to it — a share link minted, a signature requested, a signature
 * completed. None of that is prose to compose; all of it is written by the upload
 * control (`CanvasLegalDocumentUpload`) or by `canvasLegalDocumentTools.ts`'s tools,
 * the same "written by a flow, not derived client-side" treatment
 * `contract.signatureState` documents. A human or a model typing a value into
 * `documentStatus` would be asserting a signature nobody actually collected — the
 * exact failure `contract.signatureState`'s own hint exists to refuse.
 *
 * ── THE THREE RECORD KINDS, AND WHY THEY ARE PROJECTIONS TOO ─────────────────────
 * `legalEntity`, `ipAsset` and `legalMatter` join `legalDocument` below, and they take
 * the SAME treatment for a different reason. A `contract` is prose with no backing
 * table — the model composes it, so its fields are authored. These three have real
 * tables (`legal_entities`, `intellectual_property`, `legal_matters`), registered
 * READ-WRITE through the generic entity layer in
 * `api/src/application/domains/legal/entities.ts`, and reachable from this canvas today
 * through `getEntityRows('legal', …)`. A card that let a model TYPE a jurisdiction, a
 * renewal date or an exposure figure beside a row that already holds one would be two
 * answers to "when does our mark lapse", and the board's answer would be the one nobody
 * filed against.
 *
 * So every field on all three is `bookkeeping: true`: readable by the model, written by
 * `canvas_sync_legal` from the real row, and excluded from the empty-shell check —
 * exactly what `legalDocument` already does, because "this card IS the record" is the
 * same claim whether the record is a file or a row. `summary` is the one authored field
 * on each, for the same reason it is authored everywhere else: the reading of a fact is
 * not the fact.
 *
 * The three record kinds are NOT gated in `canvasApprovalGate.GATED_ACTIONS`: `sync` is
 * their only act, it re-reads rows this tenant already owns, and nothing leaves the
 * building. That is the same test `legalDocument.upload`/`sync` pass and `share` fails.
 *
 * `documentStatus` — NOT `status` — because `status` is the COMMON card-subtitle field
 * every kind already owns (`COMMON_MUTABLE_FIELDS` in the registry) and several sync
 * flows across the canvas (`account`, `salesPipeline`, `budget`…) write a short human
 * sentence directly onto it. A spec field also named `status` would either collide
 * with that convention or draw the same information twice on one card. `contract` hit
 * this exact fork and resolved it the same way, calling its own derived axis
 * `signatureState`; `dataRoom` calls its `ndaState`. `documentStatus` is this kind's
 * name for the same idea — and `entityStatus`, `ipStatus` and `matterStatus` below are
 * the three record kinds' names for it, one per kind rather than one shared `recordState`
 * because the three vocabularies genuinely differ (`good-standing` is not a thing a
 * trademark can be) and a shared field would have to document all three at once.
 */

import { LEGAL_OBJECT_KINDS, type LegalObjectKind } from '@builderforce/creation-canvas-contract';
// The counterparty resolver, from the vocabulary that declares it. `legalMatter` names an
// ADVERSE party and `party_roles` already holds them, so a matter joins to the same
// `account` card an invoice and a contract join to — see `founderObjects.ts` for why the
// resolution is a live lookup rather than a stored id. `placement.client` reuses it from
// the hiring vocabulary on the same argument.
import { COUNTERPARTY_HINT, counterpartyAccountField } from './founderObjects';
import { deriveNumber, registerSpecObjectSet, SUMMARY_FIELD, type SpecObjectSpec } from './specObjects';

/** i18n namespace for every legal label, field and status. */
export const LEGAL_NAMESPACE = 'creationCanvas.legal';

/**
 * The document categories the backend accepts — `legalDocumentRoutes.ts` and
 * `legalDocumentStore.ts`'s `CATEGORIES`, restated here because the upload control and
 * the model-facing hint both need the exact list and a THIRD copy is how one of the
 * three quietly drifts.
 */
export const LEGAL_DOCUMENT_CATEGORIES = [
  'nda', 'msa', 'sow', 'offer_letter', 'ip_assignment', 'formation', 'registration', 'other',
] as const;
export type LegalDocumentCategory = typeof LEGAL_DOCUMENT_CATEGORIES[number];

/** The backend-derived lifecycle a `legalDocument` card passes through. Restated for
 *  the same reason as the categories above. */
export const LEGAL_DOCUMENT_STATUSES = ['draft', 'shared', 'awaiting_signature', 'declined', 'signed'] as const;

/**
 * The record vocabularies, restated from the Drizzle columns they project.
 *
 * Restated for the reason the categories above are: the model-facing hint and the
 * `canvas_sync_legal` projection both need the exact list, and a hint that paraphrases
 * one is a third copy that drifts. These are the `varchar` check-vocabularies documented
 * on `api/src/infrastructure/database/schema/legal.ts`, verbatim and in the same order.
 */
export const LEGAL_ENTITY_TYPES = ['c-corp', 'llc', 'ltd', 'gmbh', 'pty', 'sole-trader', 'partnership'] as const;
export const LEGAL_ENTITY_STATUSES = ['active', 'good-standing', 'delinquent', 'dissolved'] as const;
export const LEGAL_REGISTRATION_KINDS = ['foreign-qualification', 'sales-tax', 'payroll-tax', 'licence', 'data-protection', 'other'] as const;
export const IP_ASSET_KINDS = ['trademark', 'patent', 'design', 'copyright', 'domain', 'trade-secret'] as const;
export const IP_ASSET_STATUSES = ['idea', 'filed', 'pending', 'registered', 'opposed', 'lapsed', 'abandoned'] as const;
export const LEGAL_MATTER_KINDS = ['advice', 'dispute', 'diligence', 'regulatory', 'employment', 'transaction'] as const;
export const LEGAL_MATTER_STATUSES = ['open', 'advice-received', 'settled', 'closed', 'escalated'] as const;
export const LEGAL_MATTER_EXPOSURES = ['low', 'medium', 'high', 'existential'] as const;

/**
 * The instruction every projected field on the three record kinds carries.
 *
 * ONE constant, for the reason `COUNTERPARTY_HINT` is one: forty-odd fields across three
 * kinds all say the same thing — this is a row, not a claim — and forty paraphrases is
 * forty chances for one of them to read as permission.
 */
const PROJECTED = 'Written by canvas_sync_legal from the real row — never authored here. A value typed onto this card is a second answer the legal seat does not hold; change the record through the entity browser or the legal seat and re-sync.';

/** The join key each record card carries. Same argument as `legalDocument.documentId`:
 *  the id is the identity, and matching a record by its title is the defect this
 *  removes. */
function recordIdField(table: string): SpecObjectSpec['fields'][number] {
  return {
    name: 'recordId',
    render: 'stat',
    label: 'recordId',
    hint: `The \`${table}\` row this card is a view of — the JOIN KEY canvas_sync_legal matches on, so a re-sync updates this card rather than authoring a second one. Empty on a card no sync has reached yet.`,
    bookkeeping: true,
  };
}

export const LEGAL_OBJECT_SPECS: readonly SpecObjectSpec[] = [
  {
    kind: 'legalDocument',
    icon: '🔏',
    group: 'Knowledge',
    defaultStatus: 'draft',
    // `upload`/`sync` are reversible and expose nothing outside the tenant, so they
    // stay OPEN. `share` and `request-signature` are OUTBOUND — a share mints a link
    // an external party can use, and a signature request emails a counterparty — so
    // both are declared in `canvasApprovalGate.GATED_ACTIONS`, the same reasoning
    // `dataRoom.share` and `contract.sign` are gated on. None of the four route
    // through `canvas_invoke_object_action` (this kind is deliberately absent from
    // `CONNECTED_CANVAS_ACTIONS` in CreationCanvas.tsx) — they are dedicated tools in
    // `canvasLegalDocumentTools.ts`, the same shape `canvas_sync_account` already is
    // for `account`, and each mutating one evaluates the gate itself.
    actions: ['upload', 'share', 'request-signature', 'sync'],
    fields: [
      {
        name: 'category', render: 'stat', label: 'category',
        hint: `The document type: ${LEGAL_DOCUMENT_CATEGORIES.join(' | ')}. Set once, at upload, by the person choosing what they are uploading — never re-typed by a later flow.`,
        bookkeeping: true,
      },
      {
        name: 'entityId', render: 'stat', label: 'entityId',
        hint: 'The `legal_entities` row this document belongs to, when it was uploaded against one. Numeric id, or empty when this document is not scoped to a single legal entity.',
        bookkeeping: true,
      },
      {
        name: 'matterId', render: 'stat', label: 'matterId',
        hint: 'The `legal_matters` row this document belongs to, when it was uploaded against one. Numeric id, or empty.',
        bookkeeping: true,
      },
      {
        name: 'ipId', render: 'stat', label: 'ipId',
        hint: 'The `intellectual_property` row this document belongs to, when it was uploaded against one. Numeric id, or empty.',
        bookkeeping: true,
      },
      {
        name: 'documentId', render: 'stat', label: 'documentId',
        hint: 'The `legal_document_files.id` this card represents — the JOIN KEY every legal-document tool needs to read or act on the real record. Written by the upload control the instant a file lands; empty on a card nobody has uploaded into yet.',
        bookkeeping: true,
      },
      {
        name: 'artifactId', render: 'stat', label: 'artifactId',
        hint: 'The `kernel.artifacts` row holding the CURRENT version\'s encrypted bytes. Re-uploading never overwrites it — a new artifact is created and this is repointed — so a signature completed against an earlier version keeps resolving to that version\'s exact bytes.',
        bookkeeping: true,
      },
      {
        name: 'checksum', render: 'stat', label: 'checksum',
        hint: 'SHA-256 of the current version\'s bytes, frozen at upload. What a signature request binds to, so the signed document cannot silently change under the signature.',
        bookkeeping: true,
      },
      {
        name: 'mime', render: 'stat', label: 'mime',
        hint: 'The current version\'s content type, as the browser reported it at upload.',
        bookkeeping: true,
      },
      {
        name: 'byteSize', render: 'stat', label: 'byteSize',
        hint: 'The current version\'s size in bytes.',
        bookkeeping: true,
      },
      {
        name: 'documentStatus', render: 'stat', label: 'documentStatus',
        hint: `${LEGAL_DOCUMENT_STATUSES.join(' | ')}. Computed server-side, every read, from this document's shares and its signature request — never stored and never asserted. Call canvas_legal_document_sync to refresh it; do not guess at it from what the card showed last.`,
        bookkeeping: true,
      },
      {
        name: 'signatureRequestId', render: 'stat', label: 'signatureRequestId',
        hint: 'The `signature_requests` row `canvas_legal_document_request_signature` created, if any. Written by that flow; re-read its progress rather than asserting completion.',
        bookkeeping: true,
      },
      {
        name: 'signedAt', render: 'stat', label: 'signedAt',
        hint: 'ISO instant every party completed the signature request, or empty. Written by canvas_legal_document_sync from the signature request\'s own record — never asserted.',
        bookkeeping: true,
      },
      {
        name: 'activeShares', render: 'stat', label: 'activeShares',
        hint: 'How many un-revoked share links currently grant access to this document. Written by canvas_legal_document_sync by RE-READING the workspace record, never by incrementing a local count — a revoke elsewhere on the board must be reflected here too.',
        bookkeeping: true,
      },
      SUMMARY_FIELD,
    ],
  },
  // ── THE COMPANY ITSELF ────────────────────────────────────────────────────────
  //
  // `taxId` is DELIBERATELY ABSENT. The column exists and the generic reader returns
  // it, but an EIN or a VAT number on a canvas is a card that gets shared, exported to
  // PDF, pasted into a data room and read by whoever the board was sent to — and none
  // of the questions this kind exists to answer ("who is our agent", "when does the
  // Delaware franchise filing lapse", "which subsidiary owns the mark") needs it. The
  // number stays in the row, where the entity browser's own access rules apply to it.
  {
    kind: 'legalEntity',
    icon: '🏛',
    group: 'Knowledge',
    // Never `active` on a blank card: `active` is a fact about a filing somebody made,
    // and a default asserting it would make the card claim good standing before any row
    // was read — the argument `budget`'s `drafting` default makes in the founder set.
    defaultStatus: 'unsynced',
    actions: ['sync'],
    fields: [
      recordIdField('legal_entities'),
      { name: 'legalName', render: 'stat', label: 'legalName', hint: `The registered legal name, exactly as filed. ${PROJECTED}` , bookkeeping: true },
      { name: 'entityType', render: 'stat', label: 'entityType', hint: `${LEGAL_ENTITY_TYPES.join(' | ')}. ${PROJECTED}`, bookkeeping: true },
      { name: 'jurisdiction', render: 'stat', label: 'jurisdiction', hint: `Where it is INCORPORATED, which is frequently not where it operates — Delaware being the usual case. Where it TRADES is one row per jurisdiction in \`registrations\`. ${PROJECTED}`, bookkeeping: true },
      { name: 'registrationNumber', render: 'stat', label: 'registrationNumber', hint: `The file or company number the registry issued. ${PROJECTED}`, bookkeeping: true },
      { name: 'formedAt', render: 'stat', label: 'formedAt', hint: `ISO date of incorporation. ${PROJECTED}`, bookkeeping: true },
      { name: 'registeredAgent', render: 'stat', label: 'registeredAgent', hint: `The agent of record. A service of process missed because nobody knew who the agent was is the failure this exists for. ${PROJECTED}`, bookkeeping: true },
      { name: 'registeredAddress', render: 'text', label: 'registeredAddress', hint: `The address service is accepted at. ${PROJECTED}`, bookkeeping: true },
      {
        name: 'renewsAt',
        render: 'stat',
        label: 'renewsAt',
        hint: `ISO date the agent appointment or the entity's own standing lapses — the field that makes this card something the board can warn about. Bind a \`trigger\` with comparator "due-within" so the filing happens before the date rather than after the penalty. ${PROJECTED}`,
        bookkeeping: true,
        deadline: true,
      },
      { name: 'entityStatus', render: 'stat', label: 'entityStatus', hint: `${LEGAL_ENTITY_STATUSES.join(' | ')}. \`delinquent\` is a real and recoverable state, not a rounding of \`dissolved\`. ${PROJECTED}`, bookkeeping: true },
      { name: 'parentEntity', render: 'stat', label: 'parentEntity', hint: `The legal name of the group parent, or empty when this IS the parent. More than one entity is the normal case — a US company with a UK subsidiary has two, and two filing calendars. ${PROJECTED}`, bookkeeping: true },
      {
        name: 'registrations',
        render: 'rows',
        label: 'registrations',
        columns: ['jurisdiction', 'kind', 'reference', 'renewsAt', 'status'],
        hint: `Permission to do business somewhere that is not where you incorporated, one row per \`legal_registrations\` record: {jurisdiction, kind, reference, renewsAt, status}. \`kind\` is one of ${LEGAL_REGISTRATION_KINDS.join(' | ')}. These lapse quietly and the first symptom is usually a penalty, so the renewal dates are here rather than in a note. ${PROJECTED}`,
        bookkeeping: true,
      },
      { name: 'notes', render: 'text', label: 'notes', hint: `Whatever the record's own notes column holds. ${PROJECTED}`, bookkeeping: true },
      SUMMARY_FIELD,
    ],
  },
  // ── WHAT WE OWN THAT IS NOT A THING ───────────────────────────────────────────
  {
    kind: 'ipAsset',
    icon: '⌗',
    group: 'Knowledge',
    // `idea` is the table's own default and the state that asserts least: a card that
    // opened at `registered` would claim a grant nobody filed for.
    defaultStatus: 'unsynced',
    actions: ['sync'],
    fields: [
      recordIdField('intellectual_property'),
      { name: 'ipKind', render: 'stat', label: 'ipKind', hint: `${IP_ASSET_KINDS.join(' | ')}. One shape for all six, because each is "a right, in a jurisdiction, in a class, with a filing date and a renewal date". ${PROJECTED}`, bookkeeping: true },
      { name: 'jurisdiction', render: 'stat', label: 'jurisdiction', hint: `Where the right runs. A mark registered in the US is not registered in the EU, and treating one filing as global is the mistake this column exists to make visible. ${PROJECTED}`, bookkeeping: true },
      { name: 'classification', render: 'stat', label: 'classification', hint: `Nice classes for a mark, IPC for a patent — the classification the filing was made under, verbatim. ${PROJECTED}`, bookkeeping: true },
      { name: 'registrationNumber', render: 'stat', label: 'registrationNumber', hint: `The application or registration number. ${PROJECTED}`, bookkeeping: true },
      { name: 'filedAt', render: 'stat', label: 'filedAt', hint: `ISO date of filing. ${PROJECTED}`, bookkeeping: true },
      { name: 'grantedAt', render: 'stat', label: 'grantedAt', hint: `ISO date it was granted, or empty while it is still pending. ${PROJECTED}`, bookkeeping: true },
      {
        name: 'renewsAt',
        render: 'stat',
        label: 'renewsAt',
        hint: `ISO date the right lapses without a renewal fee or a statement of use. Bind a \`trigger\` with comparator "due-within": a mark nobody renewed is a mark somebody else can register. ${PROJECTED}`,
        bookkeeping: true,
        deadline: true,
      },
      { name: 'ipStatus', render: 'stat', label: 'ipStatus', hint: `${IP_ASSET_STATUSES.join(' | ')}. ${PROJECTED}`, bookkeeping: true },
      { name: 'assignedFrom', render: 'stat', label: 'assignedFrom', hint: `Who the right was assigned FROM — a founder, a contractor, an acquired company. Empty means unassigned, which is a FINDING and not a blank: work done before incorporation belongs to whoever did it until it is assigned. ${PROJECTED}`, bookkeeping: true },
      { name: 'assignedAt', render: 'stat', label: 'assignedAt', hint: `ISO date the assignment was executed. ${PROJECTED}`, bookkeeping: true },
      { name: 'owner', render: 'stat', label: 'owner', hint: `The single person here accountable for keeping this filed and renewed. Not a team. ${PROJECTED}`, bookkeeping: true },
      { name: 'entityName', render: 'stat', label: 'entityName', hint: `The legal name of the \`legalEntity\` that holds this right. Which of two entities owns a mark is the question a diligence request asks first. ${PROJECTED}`, bookkeeping: true },
      {
        name: 'assignment',
        render: 'verdict',
        label: 'assignment',
        // The schema's own comment says an empty `assigned_from` "is a finding and not a
        // blank", and until this field the card drew nothing at all for it — the finding
        // was invisible in exactly the state it matters. Computed from this card's own
        // two columns, so it cannot disagree with the pair printed beside it.
        hint: 'COMPUTED. Whether this right has actually been assigned to the company, and when.',
        derive: (data) => {
          const from = typeof data.assignedFrom === 'string' ? data.assignedFrom.trim() : '';
          const at = typeof data.assignedAt === 'string' ? data.assignedAt.trim() : '';
          if (!from) {
            return 'NOT ASSIGNED. No assignor is recorded, so on this record the right still belongs to whoever created it. That is a diligence finding, not a missing field — record the assignment or say plainly that there is none.';
          }
          return at
            ? `Assigned from ${from} on ${at.slice(0, 10)}.`
            : `Assigned from ${from}, with NO execution date recorded — an assignment nobody dated is one a counterparty can put after the filing.`;
        },
      },
      { name: 'notes', render: 'text', label: 'notes', hint: `Whatever the record's own notes column holds. ${PROJECTED}`, bookkeeping: true },
      SUMMARY_FIELD,
    ],
  },
  // ── WHAT IS BEING ARGUED ──────────────────────────────────────────────────────
  {
    kind: 'legalMatter',
    icon: '§',
    group: 'Knowledge',
    defaultStatus: 'unsynced',
    actions: ['sync'],
    fields: [
      recordIdField('legal_matters'),
      { name: 'matterKind', render: 'stat', label: 'matterKind', hint: `${LEGAL_MATTER_KINDS.join(' | ')}. A matter is a thing being ARGUED, which is what distinguishes it from a governance finding (a control that failed) and from a support ticket (nobody is adverse). ${PROJECTED}`, bookkeeping: true },
      { name: 'counterparty', render: 'stat', label: 'counterparty', hint: `The adverse party, or empty for a matter with no other side (advice, a regulatory filing). ${COUNTERPARTY_HINT}`, bookkeeping: true },
      counterpartyAccountField('counterparty'),
      { name: 'counsel', render: 'stat', label: 'counsel', hint: `External counsel of record. ${PROJECTED}`, bookkeeping: true },
      { name: 'owner', render: 'stat', label: 'owner', hint: `The single person here accountable for this matter. Not a team — a matter nobody owns is a matter nobody answers counsel on. ${PROJECTED}`, bookkeeping: true },
      { name: 'matterStatus', render: 'stat', label: 'matterStatus', hint: `${LEGAL_MATTER_STATUSES.join(' | ')}. ${PROJECTED}`, bookkeeping: true },
      { name: 'exposure', render: 'stat', label: 'exposure', hint: `${LEGAL_MATTER_EXPOSURES.join(' | ')} — how bad this gets if it goes the wrong way. ${PROJECTED}`, bookkeeping: true },
      { name: 'currency', render: 'stat', label: 'currency', hint: `ISO-4217 code for both amounts on this card. ${PROJECTED}`, bookkeeping: true },
      { name: 'exposureAmount', render: 'stat', label: 'exposureAmount', hint: `Estimated financial exposure, as a plain number in major units. ${PROJECTED}`, bookkeeping: true },
      { name: 'spendToDate', render: 'stat', label: 'spendToDate', hint: `What has actually been spent arguing it, as a plain number in major units. Two numbers rather than one "cost", because they answer different questions and a single column ends up meaning whichever the last writer intended. ${PROJECTED}`, bookkeeping: true },
      {
        name: 'spendAgainstExposure',
        render: 'verdict',
        label: 'spendAgainstExposure',
        // Arithmetic over the two figures printed directly above it, so it cannot
        // disagree with them. The question it answers — "are we spending more defending
        // this than it could ever cost us" — is the one a founder asks about a matter
        // and the one two separate numbers on a card never volunteer.
        hint: 'COMPUTED. What has been spent so far, set against what this could cost.',
        derive: (data) => {
          const spend = deriveNumber(data.spendToDate);
          const exposure = deriveNumber(data.exposureAmount);
          if (spend === undefined || exposure === undefined || exposure <= 0) return undefined;
          const share = Math.round((spend / exposure) * 100);
          return share >= 100
            ? `Spend to date is ${share}% of the estimated exposure — more has gone on arguing this than it is estimated to be worth. That is a settlement conversation, not a budget line.`
            : `Spend to date is ${share}% of the estimated exposure.`;
        },
      },
      { name: 'openedAt', render: 'stat', label: 'openedAt', hint: `ISO date the matter opened. ${PROJECTED}`, bookkeeping: true },
      {
        name: 'nextActionAt',
        render: 'stat',
        label: 'nextActionAt',
        hint: `ISO date this matter is next JUDGED against — a filing deadline, a hearing, a response-by. Bind a \`trigger\` with comparator "due-within": this is the one date on the card that has a consequence attached to missing it. ${PROJECTED}`,
        bookkeeping: true,
        deadline: true,
      },
      { name: 'closedAt', render: 'stat', label: 'closedAt', hint: `ISO date it closed, or empty while it is live. ${PROJECTED}`, bookkeeping: true },
      {
        name: 'timeline',
        render: 'rows',
        label: 'timeline',
        columns: ['at', 'event', 'note'],
        hint: `The matter's chronology, one row per milestone: {at, event, note}. Held on the record and not in \`activity_log\` because a matter's chronology is EDITABLE — counsel corrects a date after the fact — and an append-only audit stream must never allow that. ${PROJECTED}`,
        bookkeeping: true,
      },
      { name: 'entityName', render: 'stat', label: 'entityName', hint: `The legal name of the \`legalEntity\` this matter is against. Which entity is named is the whole question in a group with a subsidiary. ${PROJECTED}`, bookkeeping: true },
      { name: 'notes', render: 'text', label: 'notes', hint: `Whatever the record's own notes column holds. ${PROJECTED}`, bookkeeping: true },
      SUMMARY_FIELD,
    ],
  },
];

/**
 * English fallbacks the object palette shows before its i18n key resolves, matching
 * how the founder and hiring sets read. The palette localizes through
 * `creationCanvas.legal.label.*`; this is never the translated string.
 */
export const LEGAL_LABELS: Record<LegalObjectKind, string> = {
  legalDocument: 'Legal document',
  legalEntity: 'Legal entity',
  ipAsset: 'IP asset',
  legalMatter: 'Legal matter',
};

/** Blank-object status, as the English fallback matching every set above. A fresh
 *  document card is a DRAFT — nothing has been shared or signed yet, which is also true
 *  before any file lands, so the same default reads correctly at every stage until
 *  upload.
 *
 *  The three record kinds start `unsynced` and not `active`, `idea` or `open`: those
 *  three are STATES OF A ROW, and a card that opened in one would claim a record it has
 *  not read yet. `unsynced` is the only thing true about a card nobody has run
 *  `canvas_sync_legal` against, and it also says what to do about it. */
export const LEGAL_STATUSES: Record<string, string> = {
  draft: 'Draft',
  unsynced: 'Not synced',
};

/** Kinds the contract declares, for the test that proves the two lists agree. */
export const LEGAL_CONTRACT_KINDS: readonly LegalObjectKind[] = LEGAL_OBJECT_KINDS;

registerSpecObjectSet({
  id: 'legal',
  namespace: LEGAL_NAMESPACE,
  specs: LEGAL_OBJECT_SPECS,
});
