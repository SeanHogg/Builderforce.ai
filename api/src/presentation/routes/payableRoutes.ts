/**
 * Payables and receivables — `/api/payables`, and the customer's own door.
 *
 * The three acts a bill has and the three an invoice has, the tenant's merchant
 * account, the collections worklist and the pay runs that make burn a fact. Every
 * rule lives in the application layer — `payables.ts`, `receivables.ts`,
 * `merchantAccount.ts`, `collectionsLadder.ts` and `payRuns.ts` — so a second
 * caller cannot reach the store through a path that forgot one. This layer
 * translates refusals into status codes and does nothing else.
 *
 * NOTE ON THE APPROVER, AND ON THE ISSUER. Both come from the SESSION and are
 * never read from the body. A route that accepted `{ approvedBy }` would make the
 * separation-of-duties check a suggestion — a caller could approve as anybody,
 * which is worse than no check at all because the record would then be signed with
 * a name that did not do it. `issuedBy` is the same field on the other side of the
 * ledger: it is who stood behind the document that left the building.
 *
 * ── TWO ROUTERS, ONE MODULE ─────────────────────────────────────────────────
 * {@link createPublicInvoiceRoutes} carries NO auth middleware: the customer has
 * no Builderforce account and never will, so their token is the authorisation and
 * the row it resolves to reports its own tenant. It lives beside the authenticated
 * half rather than in a "public" module for the reason `formRoutes.ts` gives: they
 * are two halves of one contract, and splitting them by authentication is how the
 * projection sent to a stranger drifts from the one the author published.
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
import {
  ReceivableError,
  chaseInvoice,
  collectionLog,
  collectionWorklist,
  invoiceByToken,
  issueInvoice,
  openReceivables,
  recordInvoicePayment,
  settleInvoiceCheckout,
  upsertInvoiceDraft,
} from '../../application/finance/receivables';
import { describeLadder } from '../../application/finance/collectionsLadder';
import { renderInvoicePdf } from '../../application/finance/invoicePdf';
import {
  MerchantError,
  disconnectMerchant,
  merchantAccount,
  startMerchantOnboarding,
} from '../../application/finance/merchantAccount';
import {
  PayRunError,
  hydratePayRuns,
  listPayRuns,
  payRunBurnByMonth,
  payRunLines,
  recordPayRun,
} from '../../application/finance/payRuns';
import { resolveAppBaseUrl } from '../../env';

/**
 * ONE translation of a refusal into a status, shared by every handler here.
 *
 * The four error types are listed rather than a shared base class being invented
 * for them: each module's error is part of ITS public contract (a caller catching
 * `ReceivableError` should not have to know that payables exists), and a common
 * ancestor would be a dependency between five application modules that otherwise
 * have none — which is the seam a new endpoint would then be tempted to reach
 * through.
 */
const handle = async (run: () => Promise<Response>): Promise<Response> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof PayableError
      || error instanceof ReceivableError
      || error instanceof MerchantError
      || error instanceof PayRunError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
};

/**
 * ONE PDF response, shared by the tenant's door and the customer's.
 *
 * The two routes differ only in how they establish WHICH invoice — a session and a
 * reference on one, a token on the other. Everything after that is the same file
 * with the same headers, and writing it twice is how a customer's copy comes to be
 * served `inline` while the founder's downloads, or one of them loses the
 * `Content-Disposition` filename and saves as `pdf`.
 *
 * `inline` and not `attachment`: the customer arrived from a link and expects to
 * SEE the invoice; their browser's own viewer offers the save. The filename still
 * rides along for when they take it.
 */
const pdfResponse = (rendered: { bytes: Uint8Array; filename: string }): Response =>
  new Response(rendered.bytes as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${rendered.filename}"`,
      // Never cached by a shared cache: the outstanding amount changes the moment a
      // payment lands, and an intermediary holding yesterday's copy would show a
      // customer a balance they have already settled.
      'Cache-Control': 'private, no-store',
    },
  });

const NO_SUCH_INVOICE = () => Response.json({ error: 'No invoice with that reference in this workspace.' }, { status: 404 });

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

  // ── The receivable's three acts (FO-C2) ──────────────────────────────────
  //
  // Addressed by REFERENCE and not by row id, unlike the bill acts above. The
  // caller is usually a canvas `invoice` card, which holds an invoice number a
  // person typed and has never seen a database id — and the reference is the
  // natural key the lines already resolve to, so nothing is lost by using it.

  /** Draft (or re-draft) a receivable. Refuses anything already issued — that is
   *  the freeze, and it lives in `receivables.ts`. */
  router.post('/invoices', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await upsertInvoiceDraft(db, c.env as Env, tenant(c), {
      reference: String(body.reference ?? ''),
      customerName: String(body.customerName ?? ''),
      customerRef: typeof body.customerRef === 'string' ? body.customerRef : null,
      amount: Number(body.amount),
      taxAmount: Number.isFinite(body.taxAmount) ? Number(body.taxAmount) : null,
      ...(typeof body.currency === 'string' ? { currency: body.currency } : {}),
      dueAt: typeof body.dueAt === 'string' ? body.dueAt : null,
      notes: typeof body.notes === 'string' ? body.notes : null,
      objectId: typeof body.objectId === 'string' ? body.objectId : null,
      ...(typeof body.collectionMode === 'string' ? { collectionMode: body.collectionMode } : {}),
      lines: Array.isArray(body.lines) ? body.lines as never : undefined,
      createdBy: actor(c),
    }));
  }));

  /** Issue it: freeze the figures, mint the customer's link, price the way to pay
   *  it, and send it. `issuedBy` comes from the session — see the module note. */
  router.post('/invoices/:reference/issue', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    return Response.json(await issueInvoice(db, c.env as Env, tenant(c), {
      reference: c.req.param('reference'),
      deliverTo: typeof body.deliverTo === 'string' ? body.deliverTo : null,
      dueAt: typeof body.dueAt === 'string' ? body.dueAt : null,
      message: typeof body.message === 'string' ? body.message : null,
      issuedBy: actor(c),
    }));
  }));

  /** Record money that arrived. Idempotent on `externalRef`, which becomes the
   *  unique ledger reference — so a double-click is one payment. */
  router.post('/invoices/:reference/payments', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await recordInvoicePayment(db, c.env as Env, tenant(c), {
      reference: c.req.param('reference'),
      amount: Number(body.amount),
      externalRef: String(body.externalRef ?? ''),
      ...(typeof body.method === 'string' ? { method: body.method } : {}),
      paidAt: typeof body.paidAt === 'string' ? body.paidAt : null,
      memo: typeof body.memo === 'string' ? body.memo : null,
      actorRef: actor(c),
    }));
  }));

  /** Chase it — one rung of the ladder, climbed by a person. The same function
   *  the sweep calls, so there is one collections history and not two. */
  router.post('/invoices/:reference/chase', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const channel = body.channel === 'internal' ? 'internal' as const : 'email' as const;
    return Response.json(await chaseInvoice(db, c.env as Env, tenant(c), {
      reference: c.req.param('reference'),
      step: Number.isFinite(body.step) ? Number(body.step) : 1,
      stepLabel: typeof body.stepLabel === 'string' && body.stepLabel ? body.stepLabel : 'Chased',
      channel,
      // A person clicking "chase" means send it. `deliver: false` is the sweep's
      // `notify` mode, which no human-initiated call is ever asking for.
      deliver: body.deliver !== false,
      deliverTo: typeof body.deliverTo === 'string' ? body.deliverTo : null,
      subject: typeof body.subject === 'string' ? body.subject : null,
      body: typeof body.body === 'string' ? body.body : null,
      detail: typeof body.detail === 'string' ? body.detail : null,
      actorRef: actor(c),
    }));
  }));

  /** What has actually been done to collect this one — the record
   *  `invoice.collection`'s hint says must exist. */
  router.get('/invoices/:reference/collection', (c) => handle(async () =>
    Response.json({ log: await collectionLog(db, tenant(c), c.req.param('reference')) })));

  /**
   * The founder's own copy of the document their customer received.
   *
   * Same bytes, same renderer, same projection — which is the point: a support
   * conversation about "what does my invoice say" is unanswerable if the two sides
   * are looking at two files.
   */
  router.get('/invoices/:reference/pdf', (c) => handle(async () => {
    const rendered = await renderInvoicePdf(db, tenant(c), c.req.param('reference'));
    return rendered ? pdfResponse(rendered) : NO_SUCH_INVOICE();
  }));

  /** Everything open, with each one's ageing already computed. */
  router.get('/receivables', (c) => handle(async () =>
    Response.json({ receivables: await openReceivables(db, tenant(c)) })));

  // ── The collections ladder (FO-C5) ───────────────────────────────────────

  /** The rungs and when each falls due. A tenant delegating the chase is
   *  entitled to see exactly what will be sent, and when. */
  router.get('/collections/ladder', (c) => handle(async () =>
    Response.json({ ladder: describeLadder() })));

  /** Rungs recorded as due and not yet sent — what `notify` mode produces, and
   *  the reason it is a mode rather than "off with extra steps". */
  router.get('/collections/worklist', (c) => handle(async () =>
    Response.json({ worklist: await collectionWorklist(db, tenant(c)) })));

  // ── The tenant's own merchant account (FO-C4) ────────────────────────────

  /** What the PROCESSOR says about the account, refreshed on every read. See
   *  `merchantAccount.ts` for why the row's own existence is not the answer. */
  router.get('/merchant', (c) => handle(async () =>
    Response.json({ merchant: await merchantAccount(db, c.env as Env, tenant(c)) })));

  /** Start or resume onboarding. Resuming is the normal case — a person who
   *  abandons the processor's form half way through must not get a second
   *  account. */
  router.post('/merchant/onboarding', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const base = resolveAppBaseUrl(c.env as Env);
    const target = typeof body.returnTo === 'string' && body.returnTo.startsWith('/') ? body.returnTo : '/billing/get-paid';
    return Response.json(await startMerchantOnboarding(db, c.env as Env, tenant(c), {
      email: typeof body.email === 'string' ? body.email : null,
      country: typeof body.country === 'string' ? body.country : null,
      returnUrl: `${base}${target}?merchant=connected`,
      // The processor sends the browser here when its own link has expired, which
      // is a request to mint a new one rather than an error to show somebody.
      refreshUrl: `${base}${target}?merchant=refresh`,
    }));
  }));

  router.delete('/merchant', (c) => handle(async () =>
    Response.json(await disconnectMerchant(db, tenant(c)))));

  // ── Pay runs (the residual of FO-C6) ─────────────────────────────────────

  router.get('/pay-runs', (c) => handle(async () =>
    Response.json({ payRuns: await listPayRuns(db, tenant(c)) })));

  router.get('/pay-runs/burn', (c) => handle(async () =>
    Response.json({ burn: await payRunBurnByMonth(db, tenant(c)) })));

  router.get('/pay-runs/:reference/lines', (c) => handle(async () =>
    Response.json({ lines: await payRunLines(db, tenant(c), c.req.param('reference')) })));

  /** Read the runs back from whichever payroll provider is connected. Answers
   *  with `connectedSources` even on a miss, so a surface can say "connect
   *  Gusto" rather than "no data". */
  router.post('/pay-runs/sync', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    return Response.json(await hydratePayRuns(db, c.env as Env, tenant(c), {
      since: typeof body.since === 'string' ? body.since : null,
      connectorKey: typeof body.connectorKey === 'string' ? body.connectorKey : null,
      ...(Number.isFinite(body.limit) ? { limit: Number(body.limit) } : {}),
    }));
  }));

  /** The manual door — a run entered from a bureau's PDF. See `payRuns.ts` for
   *  why refusing it would make the feature available only to the companies who
   *  needed it least. */
  router.post('/pay-runs', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await recordPayRun(db, tenant(c), {
      source: typeof body.source === 'string' && body.source ? body.source : 'manual',
      externalRef: String(body.externalRef ?? ''),
      ...(typeof body.currency === 'string' ? { currency: body.currency } : {}),
      ...(typeof body.status === 'string' ? { status: body.status } : {}),
      periodStart: typeof body.periodStart === 'string' ? body.periodStart : null,
      periodEnd: typeof body.periodEnd === 'string' ? body.periodEnd : null,
      paidAt: typeof body.paidAt === 'string' ? body.paidAt : null,
      grossAmount: Number.isFinite(body.grossAmount) ? Number(body.grossAmount) : null,
      employerTaxes: Number.isFinite(body.employerTaxes) ? Number(body.employerTaxes) : null,
      totalCost: Number(body.totalCost),
      ...(Number.isFinite(body.employeeCount) ? { employeeCount: Number(body.employeeCount) } : {}),
      notes: typeof body.notes === 'string' ? body.notes : null,
      objectId: typeof body.objectId === 'string' ? body.objectId : null,
      lines: Array.isArray(body.lines) ? body.lines as never : undefined,
    }));
  }));

  return router;
}

/**
 * The CUSTOMER's door — `/api/public/invoices`. No session, no middleware.
 *
 * The person reading this has no Builderforce account and never will, so their
 * token is the authorisation and the row it resolves to reports its own tenant.
 * Mounting it under the authenticated tree would not make it stricter; it would
 * make an invoice unpayable.
 */
export function createPublicInvoiceRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  /** The document, resolved by the token in the link we emailed. */
  router.get('/', (c) => handle(async () => {
    const resolved = await invoiceByToken(db, c.req.query('t') ?? '');
    if (!resolved) return Response.json({ error: 'That invoice link is not valid. Ask for a fresh one.' }, { status: 404 });
    return Response.json({ invoice: resolved.document });
  }));

  /**
   * The document as a FILE.
   *
   * The token resolves the row exactly as the JSON read does, so this cannot be
   * used to render an invoice whose reference somebody guessed. See
   * `invoicePdf.ts` for why "print this page" was not an acceptable answer.
   */
  router.get('/pdf', (c) => handle(async () => {
    const resolved = await invoiceByToken(db, c.req.query('t') ?? '');
    if (!resolved) return Response.json({ error: 'That invoice link is not valid. Ask for a fresh one.' }, { status: 404 });
    const rendered = await renderInvoicePdf(db, resolved.tenantId, resolved.document.reference);
    return rendered ? pdfResponse(rendered) : NO_SUCH_INVOICE();
  }));

  /**
   * Settle the checkout the customer just completed.
   *
   * Called from the redirect. The session id arrives in the customer's own
   * address bar, so NOTHING here trusts it: `settleInvoiceCheckout` re-reads the
   * session from the processor and refuses one that names a different invoice.
   * The token is still required — this route may not be used to poke at an
   * invoice whose reference somebody guessed.
   */
  router.post('/settle', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const resolved = await invoiceByToken(db, c.req.query('t') ?? String(body.token ?? ''));
    if (!resolved) return Response.json({ error: 'That invoice link is not valid.' }, { status: 404 });
    const checkoutSessionId = String(body.checkoutSessionId ?? '');
    if (!checkoutSessionId) return Response.json({ error: 'No payment was named.' }, { status: 400 });
    return Response.json(await settleInvoiceCheckout(db, c.env as Env, {
      tenantId: resolved.tenantId,
      invoiceRef: resolved.document.reference,
      checkoutSessionId,
    }));
  }));

  return router;
}
