/**
 * Template → signature request → the message that tells somebody it is waiting.
 *
 * ── WHY THIS IS ONE FUNCTION AND NOT THREE CALLS AT EACH CALLER ──────────────
 * Three consumers need the same sequence: the co-founder surface sending a
 * founders' agreement (FO-D5), the data room sending its NDA before it will open
 * (FO-E2), and any future surface that has a template and a counterparty. Each
 * step is already a primitive — `renderDocumentTemplate`, `createSignatureRequest`,
 * `deliverSignatureInvitations` — and the failure mode of writing the sequence per
 * caller is specific and known: one of them forgets the delivery, and the feature
 * "works" in the sense that a row exists and nobody is ever told.
 *
 * ── WHO SIGNS COMES FROM THE DOCUMENT, NOT FROM A SECOND ARGUMENT ────────────
 * By default the signers ARE the parties the rendered document names. A caller can
 * override — the data room's NDA binds one recipient who is not written into the
 * template's party table — but it cannot silently disagree with the text, because
 * the default is the text.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────────
 * No storage of the rendered body beside the signature request. The request
 * already freezes `documentBody` verbatim, and that copy is the evidentiary one
 * (see `signatureEngine`'s note). A second copy on a canvas object or in
 * `legal_document_files` would be a second answer to "what did they sign".
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { createSignatureRequest } from '../signature/signatureEngine';
import { deliverSignatureInvitations } from '../signature/signatureInvitations';
import { renderDocumentTemplate, type RenderedDocument, type TemplateValues } from './documentTemplates';

export interface SendTemplatedDocumentInput {
  templateKey: string;
  values: TemplateValues;
  /** Overrides the signers. Omit to use the parties the DOCUMENT itself names. */
  parties?: Array<{ name: string; email: string; partyRef?: string | null }>;
  /** The canvas object this belongs to, so `/api/objects/:id/activity` and the
   *  card's own `signatureRequestId` resolve to the same request. */
  objectId?: string | null;
  subject?: string | null;
  expiresAt?: string | null;
  remindAfterDays?: number;
  createdBy?: string | null;
}

export interface SentTemplatedDocument {
  requestId: number;
  status: string;
  document: RenderedDocument;
  delivery: { sent: number; failed: number };
}

export async function sendTemplatedDocument(
  db: Db,
  env: Env,
  tenantId: number,
  input: SendTemplatedDocumentInput,
): Promise<SentTemplatedDocument> {
  const document = renderDocumentTemplate(input.templateKey, input.values);

  const parties = (input.parties?.length
    ? input.parties
    : document.parties.map((party) => ({ name: party.name, email: party.email, partyRef: null })))
    .filter((party) => party.name?.trim() && party.email?.includes('@'));

  const subject = input.subject?.trim() || document.title;
  const created = await createSignatureRequest(db, tenantId, {
    subject,
    intent: document.intent,
    documentTitle: document.title,
    documentBody: document.body,
    // Provenance, not resolution: what the text was rendered FROM, for a reader
    // asking later which template version produced it.
    documentRef: `template:${document.key}`,
    objectId: input.objectId ?? null,
    expiresAt: input.expiresAt ?? null,
    ...(input.remindAfterDays != null ? { remindAfterDays: input.remindAfterDays } : {}),
    createdBy: input.createdBy ?? null,
    parties: parties.map((party) => ({ name: party.name, email: party.email, partyRef: party.partyRef ?? null })),
  });

  const delivery = await deliverSignatureInvitations(
    env,
    { subject, documentTitle: document.title, intent: document.intent, expiresAt: input.expiresAt ?? null },
    created.invitations.map((invitation) => ({ email: invitation.email, name: invitation.name, token: invitation.token })),
  );

  return { requestId: created.requestId, status: created.status, document, delivery };
}
