/**
 * Getting a signature request to the people who have to answer it.
 *
 * ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────
 * `createSignatureRequest` minted one credential per party and returned the
 * plaintext to its caller exactly once, and — exactly like the form half — there
 * was nothing behind it. The engine could create a request, freeze the terms,
 * record a decision and chase a silent party, and the FIRST message, the one that
 * tells somebody a document is waiting for them, was never sent by anything. So
 * `contract.sign` worked end to end only if a person copied each party's link out
 * of an API response.
 *
 * ── WHY THE INVITATION AND THE REMINDER SHARE A MODULE ───────────────────────
 * They are the same message at two moments, and the reminder is the one that
 * proves it: a chase that cannot quote the signer's own address is not a reminder,
 * it is a notification that something exists somewhere. Both compose through
 * `deliverShareInvitations`, so the template, the escaping and the
 * one-failure-does-not-stop-the-batch rule are defined once.
 *
 * ── THE REMINDER RE-ISSUES ───────────────────────────────────────────────────
 * Only the HASH of a party's token is stored, so the sweep used to point everyone
 * at `/sign` — the landing page — and ask them to find the link they were sent.
 * It now mints a fresh token per pending party through `reissuePartyToken` and
 * links to `/sign/<token>`. That keeps the one-way property exactly as it was
 * (nothing plaintext is ever stored) and produces a link that opens. The previous
 * link stops working, which is the cost, and it is charged only when a message
 * carrying the replacement is about to be sent.
 */

import type { Env } from '../../env';
import { resolveAppBaseUrl } from '../../env';
import { deliverShareInvitations, type ShareInvitation } from '../security/shareInvitationMailer';
import type { SignatureIntent } from '@builderforce/creation-canvas-contract';

const SOURCE = 'application/signature/signatureInvitations.ts';

/**
 * The signer's own address.
 *
 * The token rides the PATH rather than a query string — the same choice
 * `createPublicSignatureRoutes` made, and for the reason it gives: both end up in
 * logs, but a path segment does not survive a `Referer` header to whatever the
 * document body happens to link to.
 */
export function signerUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/sign/${encodeURIComponent(token)}`;
}

/** `sign` and `acknowledge` are different acts with different evidentiary
 *  weight — the whole reason `intent` is a column — so the message says which. */
const verbFor = (intent: SignatureIntent): string => (intent === 'acknowledge' ? 'acknowledge' : 'sign');

export interface SignatureRequestForInvitation {
  subject: string;
  documentTitle: string;
  intent: SignatureIntent;
  expiresAt?: Date | string | null;
}

function expiryNote(expiresAt: Date | string | null | undefined): string | undefined {
  if (!expiresAt) return undefined;
  const date = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return undefined;
  return `This request expires on ${date.toISOString().slice(0, 10)}.`;
}

/**
 * Send each party the document they have been asked to answer, at send time.
 *
 * Called with the plaintext tokens `createSignatureRequest` returned, which is the
 * only moment they exist. Never throws — see the mailer's failure policy.
 */
export async function deliverSignatureInvitations(
  env: Env,
  request: SignatureRequestForInvitation,
  invitations: readonly ShareInvitation[],
): Promise<{ sent: number; failed: number }> {
  if (!invitations.length) return { sent: 0, failed: 0 };
  const base = resolveAppBaseUrl(env);
  const verb = verbFor(request.intent);
  return deliverShareInvitations(env, invitations, {
    subject: request.subject,
    body: `You have been asked to ${verb} "${request.documentTitle}".`,
    actionLabel: verb === 'acknowledge' ? 'Review and acknowledge' : 'Review and sign',
    ...(expiryNote(request.expiresAt) ? { footnote: expiryNote(request.expiresAt)! } : {}),
    linkFor: (token) => signerUrl(base, token),
  }, SOURCE);
}

export interface SignatureReminderMessageInput {
  subject: string;
  documentTitle: string;
  intent: SignatureIntent;
}

/**
 * The chase, with a working link.
 *
 * Separate from the invitation because the words are different — a reminder must
 * say that the previous link no longer works, or the recipient will try the one
 * in their inbox first and conclude the product is broken.
 */
export async function deliverSignatureReminders(
  env: Env,
  request: SignatureReminderMessageInput,
  invitations: readonly ShareInvitation[],
): Promise<{ sent: number; failed: number }> {
  if (!invitations.length) return { sent: 0, failed: 0 };
  const base = resolveAppBaseUrl(env);
  const verb = verbFor(request.intent);
  return deliverShareInvitations(env, invitations, {
    subject: `Reminder: ${request.documentTitle}`,
    body: `You have not yet ${verb}d "${request.documentTitle}". Your link is below — it replaces the one you were sent.`,
    actionLabel: verb === 'acknowledge' ? 'Review and acknowledge' : 'Review and sign',
    footnote: request.subject,
    linkFor: (token) => signerUrl(base, token),
  }, SOURCE);
}
