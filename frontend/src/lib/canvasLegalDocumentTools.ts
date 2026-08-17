/**
 * The canvas's LEGAL-DOCUMENT vocabulary — share, revoke, request a signature, and
 * refresh a `legalDocument` card's derived state.
 *
 * ── WHY A MODULE AND NOT MORE OF CreationCanvas.tsx ─────────────────────────
 * Same argument `canvasFounderOpsTools.ts` makes: these are pure functions over an
 * injected context, unit-testable without React or a board.
 *
 * ── WHY THESE ARE DEDICATED TOOLS AND NOT `canvas_invoke_object_action` ──────
 * `legalDocument` is deliberately absent from `CONNECTED_CANVAS_ACTIONS` in
 * `CreationCanvas.tsx` — the same shape `account`'s `sync` and `salesPipeline`'s
 * `refresh` already are. A generic, argument-less action dispatch cannot carry a
 * recipient email or a list of signing parties, and a real share or signature
 * request needs one. So each act below is its own named tool with its own typed
 * arguments, exactly the way `canvas_sync_account` reaches `party_roles` directly
 * rather than through the generic dispatcher.
 *
 * ── THE APPROVAL GATE ─────────────────────────────────────────────────────────
 * `share` and `request-signature` are OUTBOUND — a share mints a link an external
 * party can use to read the file, and a signature request emails a counterparty —
 * the same shape `dataRoom.share` and `contract.sign` are gated on
 * (`canvasApprovalGate.GATED_ACTIONS.legalDocument`). Because these tools do not
 * pass through `canvas_invoke_object_action` (the ONE place that gate is normally
 * evaluated), each of the two gated tools below evaluates it itself, at the same
 * point `canvas_invoke_object_action` would have. `upload` (a UI control, not a
 * tool) and `sync`/`revoke` are not gated: uploading and refreshing expose nothing
 * new, and revoking only ever REDUCES what is already shared.
 *
 * ── WHY `activeShares` IS NEVER HAND-INCREMENTED ─────────────────────────────
 * `share` could return `activeShares + 1` for free. It re-fetches the whole
 * document and writes what the workspace actually reports instead, because a
 * hand-incremented count silently disagrees with reality the first time a share is
 * revoked from a second tab, an expired share lapses, or two shares are created in
 * the same turn. `canvas_legal_document_sync` is the one function that reads the
 * real count, so every mutating tool below calls it rather than computing its own
 * answer.
 */

import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { evaluateGate, readProvenance, type ApprovalMode } from '@/lib/canvasApprovalGate';
import type { CanvasFounderOpsContext } from '@/lib/canvasFounderOpsTools';
import {
  getLegalDocument, requestLegalDocumentSignature, revokeLegalDocumentShare, shareLegalDocument,
  type LegalDocumentDetail,
} from '@/lib/legalDocumentApi';

const NO_TENANT = 'This needs a signed-in, saved canvas session: it reads and writes a real workspace record, and an anonymous board has no workspace behind it. Say so in one sentence and keep building what this canvas can hold; never claim it ran.';

/** Plain-English subtitle for the card's common `status` field, kept in step with
 *  the derived `documentStatus` this same patch writes — see `legalObjects.ts` for
 *  why the two are separate fields. */
function statusLabel(status: LegalDocumentDetail['status']): string {
  switch (status) {
    case 'shared': return 'Shared';
    case 'awaiting_signature': return 'Awaiting signature';
    case 'declined': return 'Declined';
    case 'signed': return 'Signed';
    default: return 'Draft';
  }
}

/** The full bookkeeping patch a `legalDocument` card takes from a fresh read of its
 *  real record — the ONLY thing that ever writes these fields once a file exists. */
function patchFromDetail(detail: LegalDocumentDetail): Record<string, unknown> {
  return {
    documentId: detail.id,
    category: detail.category,
    entityId: detail.entityId,
    matterId: detail.matterId,
    ipId: detail.ipId,
    artifactId: detail.artifact?.id ?? null,
    checksum: detail.artifact?.checksum ?? null,
    mime: detail.artifact?.mime ?? null,
    byteSize: detail.artifact?.byteSize ?? null,
    documentStatus: detail.status,
    signatureRequestId: detail.signatureRequestId,
    signedAt: detail.signedAt,
    activeShares: detail.activeShares,
    status: statusLabel(detail.status),
  };
}

type BoardObject = { id: string; kind: string; title: string; data: Record<string, unknown> };

/** Resolve a `legalDocument` card and its join key, or the tool error to return. */
function findLegalDocument(
  ctx: CanvasFounderOpsContext,
  objectId: string | undefined,
): { object: BoardObject; documentId: string } | { error: string } {
  if (!objectId) return { error: 'objectId is required' };
  const object = ctx.objects().find((candidate) => candidate.id === objectId && candidate.kind === 'legalDocument');
  if (!object) return { error: 'No legalDocument object with that id on this board.' };
  const documentId = typeof object.data.documentId === 'string' ? object.data.documentId.trim() : '';
  if (!documentId) {
    return { error: 'This card has no uploaded file yet — its documentId is empty. Upload a file with the card\'s upload control first.' };
  }
  return { object, documentId };
}

/** The one place `share`/`request-signature` check the approval gate, matching how
 *  `canvas_invoke_object_action` checks it for every other kind's gated act. */
function gateOrError(object: BoardObject, action: 'share' | 'request-signature'): { error: string } | null {
  const gate = evaluateGate({
    kind: 'legalDocument',
    action,
    ...(typeof object.data.approvalMode === 'string' ? { mode: object.data.approvalMode as ApprovalMode } : {}),
    actor: { kind: 'brain', ref: 'brain', name: 'Brain' },
    provenance: readProvenance(object.data),
  });
  return gate.allowed ? null : { error: gate.message };
}

/** Re-read the real record and write it back onto the card — the only writer for
 *  `documentStatus`/`signatureRequestId`/`signedAt`/`activeShares`. */
async function syncFromServer(ctx: CanvasFounderOpsContext, object: BoardObject, documentId: string, label: string): Promise<LegalDocumentDetail> {
  const detail = await getLegalDocument(documentId);
  ctx.updateObject(object.id, patchFromDetail(detail), label);
  return detail;
}

export function canvasLegalDocumentActions(ctx: CanvasFounderOpsContext): BrainAction[] {
  const guard = (): { error: string } | null => {
    if (!ctx.hasTenant) return { error: NO_TENANT };
    if (!ctx.canEdit) return { error: 'The current session role cannot edit this canvas' };
    return null;
  };

  return [
    {
      name: 'canvas_legal_document_sync',
      description:
        'Refresh a `legalDocument` card\'s derived state — documentStatus, signatureRequestId, signedAt and activeShares — from the real workspace record. This is the ONLY way those fields are ever updated on the board: call it right after canvas_legal_document_share, canvas_legal_document_revoke_share or canvas_legal_document_request_signature, and call it before answering ANY question about a legal document\'s current state ("has this been signed", "is it still shared", "who does it await") — the card can be stale.',
      parameters: {
        type: 'object', required: ['objectId'], additionalProperties: false,
        properties: { objectId: { type: 'string', description: 'The legalDocument card to refresh.' } },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as { objectId?: string };
        const found = findLegalDocument(ctx, args.objectId);
        if ('error' in found) return found;
        const detail = await syncFromServer(ctx, found.object, found.documentId, 'Synced legal document');
        return {
          ok: true, proposed: true, objectId: found.object.id,
          documentStatus: detail.status, activeShares: detail.activeShares, signedAt: detail.signedAt,
        };
      },
    },
    {
      name: 'canvas_legal_document_share',
      description:
        'Mint a share link for a legalDocument\'s CURRENT file — an external party can read it (or download it, with permission "download") without a Builderforce account. GATED: this leaves the workspace, so it needs a named approver before it takes effect (see canvasApprovalGate). Returns the plaintext token/link EXACTLY ONCE — tell the user the link now, in your reply; it cannot be retrieved again after this call. Call canvas_legal_document_sync afterward (or rely on this tool\'s own re-fetch) rather than assuming activeShares went up by one.',
      parameters: {
        type: 'object', required: ['objectId'], additionalProperties: false,
        properties: {
          objectId: { type: 'string' },
          permission: { type: 'string', enum: ['view', 'download'], description: 'Defaults to view.' },
          recipientEmail: { type: 'string', description: 'Who this link is for, if known. Never invent one — omit rather than guess.' },
          expiresAt: { type: 'string', description: 'ISO instant the link stops working. Omit for no expiry.' },
        },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as { objectId?: string; permission?: 'view' | 'download'; recipientEmail?: string; expiresAt?: string };
        const found = findLegalDocument(ctx, args.objectId);
        if ('error' in found) return found;
        const blockedByGate = gateOrError(found.object, 'share');
        if (blockedByGate) return blockedByGate;

        const share = await shareLegalDocument(found.documentId, {
          ...(args.permission ? { permission: args.permission } : {}),
          ...(args.recipientEmail ? { recipientEmail: args.recipientEmail } : {}),
          ...(args.expiresAt ? { expiresAt: args.expiresAt } : {}),
        });
        const detail = await syncFromServer(ctx, found.object, found.documentId, 'Shared legal document');
        // `/legal-documents/shared/:token` is a real page (LegalDocumentShareViewer) —
        // built alongside this tool, not a placeholder link.
        const shareUrl = typeof window !== 'undefined'
          ? `${window.location.origin}/legal-documents/shared/${share.token}`
          : `/legal-documents/shared/${share.token}`;

        return {
          ok: true, proposed: true, objectId: found.object.id,
          shareId: share.shareId, token: share.token, permission: share.permission, expiresAt: share.expiresAt,
          shareUrl, activeShares: detail.activeShares,
          instruction: `Tell the user this link now — it will not be shown again: ${shareUrl}`,
        };
      },
    },
    {
      name: 'canvas_legal_document_revoke_share',
      description: 'Revoke one active share link for a legalDocument, immediately. Not gated: revoking only ever reduces external access.',
      parameters: {
        type: 'object', required: ['objectId', 'shareId'], additionalProperties: false,
        properties: { objectId: { type: 'string' }, shareId: { type: 'string' } },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as { objectId?: string; shareId?: string };
        const found = findLegalDocument(ctx, args.objectId);
        if ('error' in found) return found;
        if (!args.shareId) return { error: 'shareId is required' };

        await revokeLegalDocumentShare(args.shareId);
        const detail = await syncFromServer(ctx, found.object, found.documentId, 'Revoked legal document share');
        return { ok: true, proposed: true, objectId: found.object.id, activeShares: detail.activeShares };
      },
    },
    {
      name: 'canvas_legal_document_request_signature',
      description:
        'Send a legalDocument\'s CURRENT uploaded file for e-signature, freezing its checksum at this instant. GATED: this emails a counterparty, so it needs a named approver first (see canvasApprovalGate). Refuses if no file has been uploaded yet. Call canvas_legal_document_sync afterward to see when a party actually signs — this call only starts the request.',
      parameters: {
        type: 'object', required: ['objectId', 'subject', 'parties'], additionalProperties: false,
        properties: {
          objectId: { type: 'string' },
          subject: { type: 'string', description: 'What the signer sees as the request subject line.' },
          intent: { type: 'string', enum: ['sign', 'acknowledge'] },
          expiresAt: { type: 'string', description: 'ISO instant the request lapses. Omit for the engine\'s default.' },
          remindAfterDays: { type: 'number' },
          parties: {
            type: 'array', minItems: 1,
            items: {
              type: 'object', required: ['name', 'email'], additionalProperties: false,
              properties: { name: { type: 'string' }, email: { type: 'string' }, partyRef: { type: 'string' } },
            },
            description: 'Who must sign. Real names and emails only — never invent one; ask the user for a missing address.',
          },
        },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as {
          objectId?: string; subject?: string; intent?: string; expiresAt?: string; remindAfterDays?: number;
          parties?: Array<{ name: string; email: string; partyRef?: string }>;
        };
        const found = findLegalDocument(ctx, args.objectId);
        if ('error' in found) return found;

        const artifactId = typeof found.object.data.artifactId === 'string' ? found.object.data.artifactId.trim() : '';
        if (!artifactId) return { error: 'Upload a file before requesting a signature.' };
        if (!args.subject?.trim()) return { error: 'subject is required' };
        if (!args.parties?.length) return { error: 'At least one signing party (name + email) is required. Ask the user for the counterparty\'s email rather than inventing one.' };

        const blockedByGate = gateOrError(found.object, 'request-signature');
        if (blockedByGate) return blockedByGate;

        const result = await requestLegalDocumentSignature(found.documentId, {
          subject: args.subject,
          ...(args.intent ? { intent: args.intent } : {}),
          ...(args.expiresAt ? { expiresAt: args.expiresAt } : {}),
          ...(args.remindAfterDays != null ? { remindAfterDays: args.remindAfterDays } : {}),
          parties: args.parties.map((party) => ({ name: party.name, email: party.email, partyRef: party.partyRef ?? null })),
        });
        const detail = await syncFromServer(ctx, found.object, found.documentId, 'Requested signature on legal document');

        return {
          ok: true, proposed: true, objectId: found.object.id,
          requestId: result.requestId, invitations: result.invitations, documentStatus: detail.status,
          instruction: 'Tell the user the signature request was sent, and to whom. Call canvas_legal_document_sync later to see when it completes — it only updates on request, never on its own.',
        };
      },
    },
  ];
}
