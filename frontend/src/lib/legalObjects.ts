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
 * `documentStatus` — NOT `status` — because `status` is the COMMON card-subtitle field
 * every kind already owns (`COMMON_MUTABLE_FIELDS` in the registry) and several sync
 * flows across the canvas (`account`, `salesPipeline`, `budget`…) write a short human
 * sentence directly onto it. A spec field also named `status` would either collide
 * with that convention or draw the same information twice on one card. `contract` hit
 * this exact fork and resolved it the same way, calling its own derived axis
 * `signatureState`; `dataRoom` calls its `ndaState`. `documentStatus` is this kind's
 * name for the same idea.
 */

import { LEGAL_OBJECT_KINDS, type LegalObjectKind } from '@builderforce/creation-canvas-contract';
import { registerSpecObjectSet, SUMMARY_FIELD, type SpecObjectSpec } from './specObjects';

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
];

/**
 * English fallbacks the object palette shows before its i18n key resolves, matching
 * how the founder and hiring sets read. The palette localizes through
 * `creationCanvas.legal.label.*`; this is never the translated string.
 */
export const LEGAL_LABELS: Record<LegalObjectKind, string> = {
  legalDocument: 'Legal document',
};

/** Blank-object status, as the English fallback matching every set above. A fresh
 *  card is a DRAFT — nothing has been shared or signed yet, which is also true before
 *  any file lands, so the same default reads correctly at every stage until upload. */
export const LEGAL_STATUSES: Record<string, string> = {
  draft: 'Draft',
};

/** Kinds the contract declares, for the test that proves the two lists agree. */
export const LEGAL_CONTRACT_KINDS: readonly LegalObjectKind[] = LEGAL_OBJECT_KINDS;

registerSpecObjectSet({
  id: 'legal',
  namespace: LEGAL_NAMESPACE,
  specs: LEGAL_OBJECT_SPECS,
});
