/**
 * Contact depth, ICPs, prospects, identity resolution and inbound deal flow
 * (PRD 19 §9).
 *
 *   GET    /api/revenue-intel/contacts/:ref            roles, education, comp    member
 *   POST   /api/revenue-intel/contacts/:ref/experience add a role                member
 *   POST   /api/revenue-intel/contacts/:ref/education  add education             member
 *   POST   /api/revenue-intel/contacts/:ref/compensation  record an observation  MANAGER
 *   GET    /api/revenue-intel/alumni?company=          the warm-intro query      member
 *   GET    /api/revenue-intel/comp-benchmark?title=    median by confidence      MANAGER
 *
 *   GET    /api/revenue-intel/searches                 searches I keep           member
 *   POST   /api/revenue-intel/searches                 claim one                 member
 *   DELETE /api/revenue-intel/searches/:id             release it                member
 *   GET    /api/revenue-intel/searches-unclaimed       safe to retire            MANAGER
 *
 *   GET    /api/revenue-intel/icps                     list                      member
 *   POST   /api/revenue-intel/icps                     define one                MANAGER
 *   POST   /api/revenue-intel/icps/:id/default         make it the default       MANAGER
 *   GET    /api/revenue-intel/icps/:id/effectiveness   does it predict?          MANAGER
 *
 *   GET    /api/revenue-intel/prospects                the queue, best first     member
 *   POST   /api/revenue-intel/prospects                score one                 member
 *   PATCH  /api/revenue-intel/prospects/:id            advance the status        member
 *
 *   POST   /api/revenue-intel/identities               map an external id        member
 *   GET    /api/revenue-intel/identities/:kind/:ref    every id it collected     member
 *   GET    /api/revenue-intel/identities-duplicates    data-quality sweep        MANAGER
 *
 *   GET    /api/revenue-intel/deal-flow                inbound queue             member
 *   POST   /api/revenue-intel/deal-flow                record inbound            member
 *   PATCH  /api/revenue-intel/deal-flow/:id            triage it                 member
 *   GET    /api/revenue-intel/deal-flow-by-source      where to spend            MANAGER
 *
 * Compensation reads and writes are MANAGER: a median salary is the most
 * sensitive number in the CRM, and "everyone can see what everyone earns" is a
 * decision an operator makes, not a default a service ships with.
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { resolveActorFromContext } from '../../application/activity/activityLog';
import {
  ContactProfileError,
  addEducation,
  alumniOf,
  claimSearch,
  compensationBenchmark,
  contactProfile,
  recordCompensation,
  releaseSearch,
  searchesFor,
  setExperience,
  unclaimedSearches,
  type Confidence,
} from '../../application/sales/contactProfile';
import {
  RevenueIntelError,
  advanceProspect,
  canonicalFor,
  createIcp,
  dealFlowBySource,
  dealFlowQueue,
  icpEffectiveness,
  identitiesFor,
  listIcps,
  prospectQueue,
  recordDealFlow,
  resolveIdentity,
  scoreProspect,
  setDefaultIcp,
  suspectedDuplicates,
  triageDealFlow,
  type DealFlowStatus,
  type EntityKind,
  type ProspectStatus,
} from '../../application/sales/revenueIntelligence';

const handle = async (run: () => Promise<Response>): Promise<Response> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ContactProfileError || error instanceof RevenueIntelError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
};

const rowId = (raw: string): number => {
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) throw new RevenueIntelError('That is not an id.', 400);
  return Math.floor(id);
};

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const when = (v: unknown): Date | null => {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new RevenueIntelError('That is not a date.', 400);
  return d;
};

export function createRevenueIntelRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  const manager = requireRole(TenantRole.MANAGER);
  const tenant = (c: { get: (k: string) => unknown }) => c.get('tenantId') as number;
  const me = (c: { get: (k: string) => unknown }) => String(c.get('userId') ?? '');
  const who = async (c: Parameters<typeof resolveActorFromContext>[2] & { env: unknown }) =>
    resolveActorFromContext(c.env as Env, db, c);

  // ── Contact depth ─────────────────────────────────────────────────────────

  router.get('/alumni', (c) => handle(async () =>
    Response.json({ contacts: await alumniOf(db, tenant(c), c.req.query('company') ?? '') })));

  router.get('/comp-benchmark', manager, (c) => handle(async () =>
    Response.json({ bands: await compensationBenchmark(db, tenant(c), c.req.query('title') ?? '') })));

  router.get('/contacts/:ref', (c) => handle(async () =>
    Response.json(await contactProfile(db, tenant(c), c.req.param('ref')))));

  router.post('/contacts/:ref/experience', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await setExperience(db, tenant(c), c.req.param('ref'), {
      company: str(body.company) ?? null,
      title: str(body.title) ?? null,
      startedAt: when(body.startedAt),
      endedAt: when(body.endedAt),
      ...(typeof body.isCurrent === 'boolean' ? { isCurrent: body.isCurrent } : {}),
      location: str(body.location) ?? null,
    }), { status: 201 });
  }));

  router.post('/contacts/:ref/education', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await addEducation(db, tenant(c), c.req.param('ref'), {
      institution: str(body.institution) ?? null,
      degree: str(body.degree) ?? null,
      field: str(body.field) ?? null,
      startedAt: when(body.startedAt),
      endedAt: when(body.endedAt),
    }), { status: 201 });
  }));

  router.post('/contacts/:ref/compensation', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const observedAt = when(body.observedAt);
    return Response.json(await recordCompensation(db, tenant(c), c.req.param('ref'), {
      base: num(body.base) ?? null,
      bonus: num(body.bonus) ?? null,
      equity: str(body.equity) ?? null,
      ...(str(body.currency) !== undefined ? { currency: str(body.currency) as string } : {}),
      period: str(body.period) ?? null,
      ...(str(body.confidence) !== undefined ? { confidence: str(body.confidence) as Confidence } : {}),
      ...(observedAt ? { observedAt } : {}),
    }), { status: 201 });
  }));

  // ── Saved searches ────────────────────────────────────────────────────────

  router.get('/searches-unclaimed', manager, (c) => handle(async () =>
    Response.json({ searches: await unclaimedSearches(db, tenant(c)) })));

  router.get('/searches', (c) => handle(async () =>
    Response.json({ searches: await searchesFor(db, tenant(c), c.req.query('ownerRef') ?? me(c)) })));

  router.post('/searches', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const savedSearchId = num(body.savedSearchId);
    if (savedSearchId === undefined) throw new RevenueIntelError('savedSearchId is required', 400);
    return Response.json(await claimSearch(db, tenant(c), savedSearchId, str(body.ownerRef) ?? me(c)), { status: 201 });
  }));

  router.delete('/searches/:id', (c) => handle(async () =>
    Response.json(await releaseSearch(db, tenant(c), rowId(c.req.param('id')), c.req.query('ownerRef') ?? me(c)))));

  // ── ICPs ──────────────────────────────────────────────────────────────────

  router.get('/icps', (c) => handle(async () => Response.json({ icps: await listIcps(db, tenant(c)) })));

  router.post('/icps', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await createIcp(db, tenant(c), {
      name: String(body.name ?? ''),
      description: str(body.description) ?? null,
      criteria: (body.criteria ?? {}) as Record<string, unknown>,
      weightings: (body.weightings ?? null) as Record<string, number> | null,
    }), { status: 201 });
  }));

  router.post('/icps/:id/default', manager, (c) => handle(async () =>
    Response.json(await setDefaultIcp(db, tenant(c), rowId(c.req.param('id'))))));

  router.get('/icps/:id/effectiveness', manager, (c) => handle(async () =>
    Response.json({ deciles: await icpEffectiveness(db, tenant(c), rowId(c.req.param('id'))) })));

  // ── Prospects ─────────────────────────────────────────────────────────────

  router.get('/prospects', (c) => handle(async () => {
    const status = c.req.query('status');
    return Response.json({ prospects: await prospectQueue(db, tenant(c), status as ProspectStatus | undefined) });
  }));

  router.post('/prospects', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const icpId = num(body.icpId);
    if (icpId === undefined) throw new RevenueIntelError('icpId is required', 400);
    return Response.json(await scoreProspect(db, tenant(c), {
      icpId,
      contactRef: str(body.contactRef) ?? null,
      companyRef: str(body.companyRef) ?? null,
      attributes: (body.attributes ?? {}) as Record<string, unknown>,
      ownerRef: str(body.ownerRef) ?? me(c),
    }), { status: 201 });
  }));

  router.patch('/prospects/:id', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await advanceProspect(
      db, c.env as Env, tenant(c), await who(c),
      rowId(c.req.param('id')), String(body.status ?? '') as ProspectStatus,
    ));
  }));

  // ── Identity resolution ───────────────────────────────────────────────────

  router.get('/identities-duplicates', manager, (c) => handle(async () =>
    Response.json({ suspects: await suspectedDuplicates(db, tenant(c)) })));

  router.post('/identities', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await resolveIdentity(db, tenant(c), {
      entityKind: String(body.entityKind ?? '') as EntityKind,
      canonicalRef: String(body.canonicalRef ?? ''),
      source: String(body.source ?? ''),
      sourceId: String(body.sourceId ?? ''),
      confidence: num(body.confidence) ?? null,
    }));
  }));

  router.get('/identities/:kind/:ref', (c) => handle(async () => {
    const kind = c.req.param('kind') as EntityKind;
    // A lookup by external id is the importer's question; by canonical ref is the
    // merge screen's. Both live here, told apart by a query parameter rather than
    // by two routes that would both look like "get identities".
    const sourceId = c.req.query('sourceId');
    if (sourceId) {
      return Response.json({ canonical: await canonicalFor(db, tenant(c), c.req.param('ref'), sourceId) });
    }
    return Response.json({ identities: await identitiesFor(db, tenant(c), kind, c.req.param('ref')) });
  }));

  // ── Deal flow ─────────────────────────────────────────────────────────────

  router.get('/deal-flow-by-source', manager, (c) => handle(async () =>
    Response.json({ sources: await dealFlowBySource(db, tenant(c)) })));

  router.get('/deal-flow', (c) => handle(async () => {
    const status = c.req.query('status');
    return Response.json({ opportunities: await dealFlowQueue(db, tenant(c), status as DealFlowStatus | undefined) });
  }));

  router.post('/deal-flow', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await recordDealFlow(db, c.env as Env, tenant(c), await who(c), {
      source: String(body.source ?? ''),
      companyName: str(body.companyName) ?? null,
      contactEmail: str(body.contactEmail) ?? null,
      summary: str(body.summary) ?? null,
      estimatedValue: num(body.estimatedValue) ?? null,
      ...(str(body.currency) !== undefined ? { currency: str(body.currency) as string } : {}),
      score: num(body.score) ?? null,
    }), { status: 201 });
  }));

  router.patch('/deal-flow/:id', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await triageDealFlow(
      db, c.env as Env, tenant(c), await who(c),
      rowId(c.req.param('id')), String(body.status ?? '') as DealFlowStatus,
    ));
  }));

  return router;
}
