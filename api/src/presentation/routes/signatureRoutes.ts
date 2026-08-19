/**
 * Signatures — the workspace half, and the PUBLIC signer.
 *
 * Same split, and the same reason, as the form routes: the signer has no session
 * and reaches the record through a credential, so their surface cannot sit under
 * auth. Every rule lives in `signatureEngine.ts`; this translates.
 *
 * THE SIGNER'S OWN EVIDENCE is composed here and nowhere else, because this is
 * the only layer that can see the request: the user agent and the address it came
 * from are transport facts. It is stamped in the same statement as the status, so
 * a signature record can never exist without the evidence of how it was made —
 * and the ADDRESS is hashed rather than stored, because a signature trail must be
 * defensible without becoming a copy of somebody's browsing history.
 */

import { Hono, type Context } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { sha256Hex } from '../../domain/shared/hash';
import {
  SignatureError,
  cancelSignatureRequest,
  createSignatureRequest,
  recordSignature,
  resolveSigner,
  signatureProgress,
} from '../../application/signature/signatureEngine';
import { deliverSignatureInvitations } from '../../application/signature/signatureInvitations';
import { ArtifactNotFoundError, loadAndDecryptArtifact } from '../../application/artifacts/artifactStore';
import { isSignatureIntent } from '@builderforce/creation-canvas-contract';

const handle = async (run: () => Promise<Response>): Promise<Response> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof SignatureError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof ArtifactNotFoundError) return Response.json({ error: error.message }, { status: 404 });
    throw error;
  }
};

export function createSignatureRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  const tenant = (c: Context<HonoEnv>) => c.get('tenantId') as number;

  /**
   * Send a request — and actually SEND it.
   *
   * The response still carries each party's plaintext token once, for the same
   * reason a form's does: only the hash is stored. That is now provenance rather
   * than the delivery mechanism. Every party is emailed the document and their own
   * signing address here, because the engine could freeze terms, record a decision
   * and chase a silent signer while the FIRST message — the one telling somebody a
   * document is waiting — was sent by nothing.
   *
   * Awaited, not fired into `waitUntil`: a request that reached nobody must not
   * report the same result as one that reached everybody.
   */
  router.post('/', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const result = await createSignatureRequest(db, tenant(c), {
      subject: String(body.subject ?? ''),
      intent: typeof body.intent === 'string' ? body.intent : undefined,
      documentTitle: String(body.documentTitle ?? ''),
      documentBody: typeof body.documentBody === 'string' ? body.documentBody : null,
      documentArtifactId: typeof body.documentArtifactId === 'string' ? body.documentArtifactId : null,
      documentChecksum: typeof body.documentChecksum === 'string' ? body.documentChecksum : null,
      documentRef: typeof body.documentRef === 'string' ? body.documentRef : null,
      objectId: typeof body.objectId === 'string' ? body.objectId : null,
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
      ...(Number.isFinite(body.remindAfterDays) ? { remindAfterDays: Number(body.remindAfterDays) } : {}),
      createdBy: (c.get('userId') as string | undefined) ?? null,
      parties: Array.isArray(body.parties)
        ? body.parties.flatMap((p) => {
            const row = p as { name?: unknown; email?: unknown; partyRef?: unknown };
            return typeof row.name === 'string' && typeof row.email === 'string'
              ? [{ name: row.name, email: row.email, partyRef: typeof row.partyRef === 'string' ? row.partyRef : null }]
              : [];
          })
        : [],
    });
    const delivery = await deliverSignatureInvitations(c.env as Env, {
      subject: String(body.subject ?? ''),
      documentTitle: String(body.documentTitle ?? ''),
      intent: isSignatureIntent(body.intent) ? body.intent : 'sign',
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
    }, result.invitations.map((invitation) => ({
      email: invitation.email,
      name: invitation.name,
      token: invitation.token,
    })));
    return Response.json({ ...result, delivery });
  }));

  /** The progress meter, derived from the parties — so it cannot claim a
   *  completion the rows do not support. */
  router.get('/:id', (c) => handle(async () => {
    const progress = await signatureProgress(db, tenant(c), Number(c.req.param('id')));
    return progress ? Response.json({ request: progress }) : Response.json({ error: 'No such request.' }, { status: 404 });
  }));

  router.post('/:id/cancel', (c) => handle(async () => {
    await cancelSignatureRequest(db, tenant(c), Number(c.req.param('id')));
    return Response.json({ ok: true });
  }));

  return router;
}

/**
 * What the signer sees, and what they decide. No session, by construction.
 *
 * The token travels in the PATH rather than a query string. Both end up in logs;
 * a path segment at least does not survive an `Referer` header to whatever the
 * document body happens to link to.
 */
export function createPublicSignatureRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.get('/:token', (c) => handle(async () => {
    const view = await resolveSigner(db, c.req.param('token'));
    if (!view) return Response.json({ error: 'That signing link is not valid.' }, { status: 404 });
    // The tenant id is dropped: the signer needs the terms and their own state,
    // and nothing about whose workspace produced them.
    const { tenantId: _tenantId, ...rest } = view;
    return Response.json({ request: rest });
  }));

  /**
   * The file behind a file-backed request (`documentArtifactId` set) — the
   * signer's own review of a bound PDF/DOCX before they decide. Re-validates
   * the token itself rather than trusting a prior GET, for the same reason the
   * decision route below does: no session means every request re-proves itself.
   */
  router.get('/:token/file', (c) => handle(async () => {
    const view = await resolveSigner(db, c.req.param('token'));
    if (!view) return Response.json({ error: 'That signing link is not valid.' }, { status: 404 });
    if (!view.documentArtifactId) return Response.json({ error: 'This request has no bound file — read documentBody instead.' }, { status: 404 });
    const file = await loadAndDecryptArtifact(db, c.env as Env, view.tenantId, view.documentArtifactId);
    return new Response(file.bytes, {
      headers: {
        'content-type': file.mime || 'application/octet-stream',
        'content-disposition': `inline; filename="${file.title.replace(/"/g, '')}"`,
        'cache-control': 'no-store',
      },
    });
  }));

  router.post('/:token', (c) => handle(async () => {
    const body = await c.req.json<{ decision?: unknown; signedName?: unknown; declineReason?: unknown }>();
    const decision = body.decision === 'decline' ? 'decline' : 'agree';
    const result = await recordSignature(db, c.req.param('token'), {
      decision,
      ...(typeof body.signedName === 'string' ? { signedName: body.signedName } : {}),
      ...(typeof body.declineReason === 'string' ? { declineReason: body.declineReason } : {}),
      evidence: {
        userAgent: (c.req.header('user-agent') ?? '').slice(0, 300),
        // Hashed, never stored. See the module note.
        addressHash: await sha256Hex(c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown'),
      },
    });
    return Response.json(result);
  }));

  return router;
}
