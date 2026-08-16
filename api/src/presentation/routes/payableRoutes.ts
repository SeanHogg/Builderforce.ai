/**
 * Payables and receivables — `/api/payables`.
 *
 * The three acts a bill has, plus the two ledgers and the ageing both directions
 * owe their surfaces. Every rule lives in `application/finance/payables.ts`,
 * including the one that matters most: the approver may not be the person who
 * entered the bill.
 *
 * NOTE ON THE APPROVER. It comes from the SESSION and is never read from the
 * body. A route that accepted `{ approvedBy }` would make the separation-of-
 * duties check a suggestion — a caller could approve as anybody, which is worse
 * than no check at all because the record would then be signed with a name that
 * did not do it.
 */

import { Hono, type Context } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  PayableError,
  ageing,
  approveBill,
  disputeBill,
  listInvoices,
  recordBill,
  scheduleBillPayment,
  scheduledPayments,
} from '../../application/finance/payables';
import { accountHistory } from '../../application/finance/accountHistory';

const handle = async (run: () => Promise<Response>): Promise<Response> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof PayableError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
};

export function createPayableRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  const tenant = (c: Context<HonoEnv>) => c.get('tenantId') as number;
  const actor = (c: Context<HonoEnv>) => String(c.get('userId') ?? '');

  router.post('/bills', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const result = await recordBill(db, c.env as Env, tenant(c), {
      reference: String(body.reference ?? ''),
      vendorName: String(body.vendorName ?? ''),
      vendorRef: typeof body.vendorRef === 'string' ? body.vendorRef : null,
      amount: Number(body.amount),
      taxAmount: Number.isFinite(body.taxAmount) ? Number(body.taxAmount) : null,
      ...(typeof body.currency === 'string' ? { currency: body.currency } : {}),
      dueAt: typeof body.dueAt === 'string' ? body.dueAt : null,
      category: typeof body.category === 'string' ? body.category : null,
      ...(typeof body.recurring === 'string' ? { recurring: body.recurring } : {}),
      notes: typeof body.notes === 'string' ? body.notes : null,
      objectId: typeof body.objectId === 'string' ? body.objectId : null,
      lines: Array.isArray(body.lines) ? body.lines as never : undefined,
      // Recorded so the approve handler can refuse self-approval. From the
      // session, never the body.
      createdBy: actor(c),
    });
    return Response.json(result);
  }));

  router.post('/bills/:id/approve', (c) => handle(async () => {
    await approveBill(db, c.env as Env, tenant(c), Number(c.req.param('id')), actor(c));
    return Response.json({ ok: true });
  }));

  router.post('/bills/:id/schedule-payment', (c) => handle(async () => {
    const body = await c.req.json<{ scheduledFor?: unknown }>();
    await scheduleBillPayment(db, c.env as Env, tenant(c), Number(c.req.param('id')), String(body.scheduledFor ?? ''));
    return Response.json({ ok: true });
  }));

  router.post('/bills/:id/dispute', (c) => handle(async () => {
    const body = await c.req.json<{ reason?: unknown }>();
    await disputeBill(db, c.env as Env, tenant(c), Number(c.req.param('id')), String(body.reason ?? ''));
    return Response.json({ ok: true });
  }));

  /** What a payment run is about to release — the list a person checks before
   *  money moves, which is the only reason `scheduled` is a distinct state. */
  router.get('/scheduled', (c) => handle(async () =>
    Response.json({ payments: await scheduledPayments(db, tenant(c)) })));

  router.get('/invoices', (c) => handle(async () =>
    Response.json({ invoices: await listInvoices(db, tenant(c), c.req.query('status')) })));

  /** Ageing for either direction, computed on read. Never stored — a stale
   *  ageing is worse than none. */
  router.get('/ageing/:direction', (c) => handle(async () => {
    const direction = c.req.param('direction');
    if (direction !== 'invoice' && direction !== 'bill') {
      return Response.json({ error: 'direction must be "invoice" or "bill".' }, { status: 400 });
    }
    return Response.json({ ageing: await ageing(db, tenant(c), direction) });
  }));

  /** One `account`'s real open invoices and open bills (FO-A3) — what
   *  `canvas_sync_account` projects onto the card's `history` field. Empty
   *  arrays for a ref with none yet, never a 404: an account can be real and
   *  simply have no open documents. */
  router.get('/accounts/:partyRef/history', (c) => handle(async () =>
    Response.json(await accountHistory(db, c.env as Env, tenant(c), c.req.param('partyRef')))));

  return router;
}
