/**
 * Forms — the workspace half, and the PUBLIC responder.
 *
 * Two routers from one module because they are two halves of one contract and
 * splitting them across files is how the projection sent to a stranger drifts
 * from the projection the author published. They are MOUNTED separately, and
 * that is the part that matters: the public one carries no auth middleware and
 * must be registered before the catch-all domain router.
 *
 * Nothing here reaches the database. Every rule that protects a real person — a
 * closed form, a wrong audience, a required question left blank, the promise that
 * an anonymous response records nobody — lives in `formPublishing.ts`, so a
 * second caller cannot reach the store through a path that forgot one. This layer
 * translates errors into status codes and nothing else.
 */

import { Hono, type Context } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  FormError,
  closeForm,
  publishForm,
  resolvePublicForm,
  submitFormResponse,
  summarizeForm,
} from '../../application/collection/formPublishing';
import { deliverFormInvitations } from '../../application/collection/formInvitations';
import { headerHints } from '../../application/email/emailLocaleResolver';

/** One translation of a refusal into a status, shared by every handler — so a
 *  new endpoint cannot invent a different code for the same rejection. */
const handle = async (run: () => Promise<Response>): Promise<Response> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof FormError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
};

export function createFormRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  const tenant = (c: Context<HonoEnv>) => c.get('tenantId') as number;

  /**
   * Publish a form, SEND it, and get its address back.
   *
   * The response still carries each named recipient's plaintext token exactly
   * once — nothing stores it, only its hash is kept — but that is now provenance
   * rather than the delivery mechanism. Every named recipient is emailed their own
   * link here, at publish time, because a form whose enforceable audience only
   * works if a person relays links is not an audience, it is a list.
   *
   * The send is AWAITED rather than fired into `waitUntil`: the caller is told how
   * many messages actually went out, and a publish that minted ten credentials and
   * delivered none must not report the same thing as one that delivered ten.
   */
  router.post('/publish', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const result = await publishForm(db, tenant(c), {
      questionSetId: typeof body.questionSetId === 'string' ? body.questionSetId : undefined,
      title: String(body.title ?? ''),
      description: typeof body.description === 'string' ? body.description : null,
      questions: body.questions,
      anonymous: body.anonymous === true,
      audience: typeof body.audience === 'string' ? body.audience : undefined,
      closesAt: typeof body.closesAt === 'string' ? body.closesAt : null,
      confirmationMessage: typeof body.confirmationMessage === 'string' ? body.confirmationMessage : null,
      objectId: typeof body.objectId === 'string' ? body.objectId : null,
      ...(Number.isFinite(body.remindAfterDays) ? { remindAfterDays: Number(body.remindAfterDays) } : {}),
      recipients: Array.isArray(body.recipients)
        ? body.recipients.flatMap((r) => {
            const row = r as { email?: unknown; name?: unknown };
            return typeof row.email === 'string' ? [{ email: row.email, ...(typeof row.name === 'string' ? { name: row.name } : {}) }] : [];
          })
        : undefined,
      createdBy: (c.get('userId') as string | undefined) ?? null,
    });
    const delivery = await deliverFormInvitations(c.env as Env, db, {
      slug: result.slug,
      title: String(body.title ?? ''),
      closesAt: typeof body.closesAt === 'string' ? body.closesAt : null,
      // The recipients are not users, so the invitation is written in the
      // PUBLISHER's language: their stored choice, and failing that the language
      // this very request is being made in.
    }, result.invitations, {
      userId: (c.get('userId') as string | undefined) ?? null,
      headers: headerHints(c.req),
    });
    return Response.json({ ...result, delivery });
  }));

  router.post('/:id/close', (c) => handle(async () => {
    await closeForm(db, tenant(c), c.req.param('id'));
    return Response.json({ ok: true });
  }));

  /** The counters the card shows — three aggregates, never a page of answers. */
  router.get('/:id/summary', (c) => handle(async () => {
    const summary = await summarizeForm(db, tenant(c), c.req.param('id'));
    return summary ? Response.json({ summary }) : Response.json({ error: 'No such form.' }, { status: 404 });
  }));

  return router;
}

/**
 * The responder's surface. Unauthenticated by construction.
 *
 * A form is answered by people who are not in the workspace — that is the entire
 * point of the primitive — so the slug is the credential and the row reports
 * which tenant it belongs to. Registering this under the authenticated tree would
 * make the feature impossible, not merely awkward.
 */
export function createPublicFormRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.get('/:slug', (c) => handle(async () => {
    const resolved = await resolvePublicForm(db, c.req.param('slug'), c.req.query('t'));
    if (!resolved) return Response.json({ error: 'No form at that address.' }, { status: 404 });
    // Deliberately only `form` — the contract's `PublishedForm` projection, which
    // carries no tenant, no session and no responses. Returning `resolved`
    // wholesale would leak the tenant id to every visitor.
    return Response.json({
      form: resolved.form,
      recipient: resolved.recipient
        ? { name: resolved.recipient.name, email: resolved.recipient.email, answered: resolved.recipient.respondedAt != null }
        : null,
    });
  }));

  router.post('/:slug', (c) => handle(async () => {
    const resolved = await resolvePublicForm(db, c.req.param('slug'), c.req.query('t'));
    if (!resolved) return Response.json({ error: 'No form at that address.' }, { status: 404 });
    const body = await c.req.json<{ answers?: Record<string, unknown> }>();
    const result = await submitFormResponse(db, resolved, {
      answers: body.answers ?? {},
      // The signed-in responder, when there is one. A `workspace` form needs it;
      // an anonymous form DISCARDS it inside the service, because the caller does
      // not get to decide that — the form does.
      respondentRef: (c.get('userId') as string | undefined) ?? null,
      env: c.env as Env,
    });
    return Response.json(result);
  }));

  return router;
}
