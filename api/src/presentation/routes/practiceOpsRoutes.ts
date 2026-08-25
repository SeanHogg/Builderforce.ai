/**
 * The last of the BurnRateOS parity work — scheduling, practice, AI operations,
 * people insight, portfolio intel and the customer-facing surface (PRD 19 §9).
 *
 *   /api/practice-ops/booking…      services, hosts, reservations, busy intervals
 *   /api/practice-ops/agency…       branding, clients, client economics
 *   /api/practice-ops/consulting…   consultations, knowledge docs, decks
 *   /api/practice-ops/ai…           tool usage, classifications, competitors, cache
 *   /api/practice-ops/people…       health dimensions, emergency contacts, cohorts
 *   /api/practice-ops/portfolio…    peer comparables, pad attachments, modules
 *   /api/practice-ops/support…      help centre, feedback widgets, uptime
 *
 *   /api/public/practice-ops/:tenantId/help…       published PUBLIC articles only
 *
 * Emergency contacts and compensation-adjacent reads are MANAGER. Booking a slot
 * is MEMBER — the whole point of a scheduling product is that people can use it —
 * while defining a service, a monitor or a widget is MANAGER.
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { resolveActorFromContext } from '../../application/activity/activityLog';
import {
  BookingError,
  addHost,
  bookingStats,
  busyIntervals,
  createService,
  listServices,
  reserve,
  serviceHosts,
  setReservationStatus,
  upcoming,
  type BookingMode,
  type ReservationStatus,
} from '../../application/commerce/bookings';
import {
  PracticeError,
  addClient,
  branding,
  clientEconomics,
  consultationsFor,
  knowledgeDocsFor,
  listClients,
  listDecks,
  listPractices,
  publishKnowledgeDoc,
  recordConsultation,
  saveDeck,
  setBranding,
  setClientStatus,
  setConsultationStatus,
  type ClientStatus,
  type ConsultationStatus,
  type DeckVisibility,
} from '../../application/commerce/agencyPractice';
import {
  AiOpsError,
  cacheSavings,
  callsForRun,
  classificationMix,
  classifyMessage,
  labelsFor,
  listCompetitors,
  purgeExpired,
  recordToolCall,
  toolUsage,
  upsertCompetitor,
  type ToolOutcome,
} from '../../application/agent/aiOperations';
import {
  PeopleInsightError,
  cohortComparison,
  cohortCurve,
  deleteEmergencyContact,
  emergencyContactsFor,
  listDimensions,
  recordCohort,
  retentionByHorizon,
  setEmergencyContact,
  upsertDimension,
  weightedScore,
} from '../../application/people/peopleInsight';
import {
  PortfolioIntelError,
  addComparable,
  allModules,
  attachToPad,
  comparableSpread,
  comparablesFor,
  detach,
  impliedValuation,
  padAttachments,
  rungLadder,
  updateAttachment,
  upsertModule,
  visibleModules,
} from '../../application/investor/portfolioIntel';
import {
  CustomerSurfaceError,
  countWidgetResponse,
  createArticle,
  evaluateProbe,
  listArticles,
  listMonitors,
  listWidgets,
  publicArticle,
  publicArticles,
  setArticleStatus,
  setArticleVisibility,
  shouldPrompt,
  upsertMonitor,
  upsertWidget,
  type ArticleStatus,
  type ArticleVisibility,
  type MonitorKind,
  type WidgetKind,
} from '../../application/support/customerSurface';

const handle = async (run: () => Promise<Response>): Promise<Response> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof BookingError || error instanceof PracticeError
      || error instanceof AiOpsError || error instanceof PeopleInsightError
      || error instanceof PortfolioIntelError || error instanceof CustomerSurfaceError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
};

const rowId = (raw: string): number => {
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) throw new BookingError('That is not an id.', 400);
  return Math.floor(id);
};

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const when = (v: unknown): Date | undefined => {
  const s = str(v);
  if (!s) return undefined;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new BookingError('That is not a date.', 400);
  return d;
};

export function createPracticeOpsRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  const manager = requireRole(TenantRole.MANAGER);
  const tenant = (c: { get: (k: string) => unknown }) => c.get('tenantId') as number;
  const who = async (c: Parameters<typeof resolveActorFromContext>[2] & { env: unknown }) =>
    resolveActorFromContext(c.env as Env, db, c);

  // ── Booking ───────────────────────────────────────────────────────────────

  router.get('/booking/services', (c) => handle(async () =>
    Response.json({ services: await listServices(db, tenant(c)) })));

  router.post('/booking/services', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await createService(db, tenant(c), {
      slug: String(body.slug ?? ''),
      name: String(body.name ?? ''),
      description: str(body.description) ?? null,
      ...(num(body.durationMin) !== undefined ? { durationMin: num(body.durationMin) as number } : {}),
      ...(num(body.bufferMin) !== undefined ? { bufferMin: num(body.bufferMin) as number } : {}),
      ...(num(body.priceCents) !== undefined ? { priceCents: num(body.priceCents) as number } : {}),
      ...(str(body.currency) !== undefined ? { currency: str(body.currency) as string } : {}),
      ...(str(body.mode) !== undefined ? { mode: str(body.mode) as BookingMode } : {}),
      ...(num(body.capacity) !== undefined ? { capacity: num(body.capacity) as number } : {}),
    }), { status: 201 });
  }));

  router.get('/booking/services/:id/hosts', (c) => handle(async () =>
    Response.json({ hosts: await serviceHosts(db, tenant(c), rowId(c.req.param('id'))) })));

  router.post('/booking/services/:id/hosts', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await addHost(db, tenant(c), rowId(c.req.param('id')), {
      hostRef: String(body.hostRef ?? ''),
      ...(str(body.timezone) !== undefined ? { timezone: str(body.timezone) as string } : {}),
      ...(num(body.priority) !== undefined ? { priority: num(body.priority) as number } : {}),
      connectionId: num(body.connectionId) ?? null,
    }), { status: 201 });
  }));

  router.get('/booking/services/:id/busy', (c) => handle(async () => {
    const from = when(c.req.query('from'));
    const to = when(c.req.query('to'));
    if (!from || !to) throw new BookingError('from and to are required', 400);
    return Response.json({ busy: await busyIntervals(db, tenant(c), rowId(c.req.param('id')), from, to) });
  }));

  router.get('/booking/upcoming', (c) => handle(async () =>
    Response.json({ reservations: await upcoming(db, tenant(c), c.req.query('hostRef')) })));

  router.get('/booking/stats', manager, (c) => handle(async () =>
    Response.json({ stats: await bookingStats(db, tenant(c)) })));

  router.post('/booking/reservations', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const startsAt = when(body.startsAt);
    const serviceId = num(body.serviceId);
    if (!startsAt || serviceId === undefined) throw new BookingError('serviceId and startsAt are required', 400);
    return Response.json(await reserve(db, c.env as Env, tenant(c), await who(c), {
      serviceId,
      startsAt,
      hostRef: str(body.hostRef) ?? null,
      bookerRef: str(body.bookerRef) ?? (c.get('userId') as string | undefined) ?? null,
      bookerEmail: str(body.bookerEmail) ?? null,
      ...(str(body.timezone) !== undefined ? { timezone: str(body.timezone) as string } : {}),
    }), { status: 201 });
  }));

  router.patch('/booking/reservations/:id', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await setReservationStatus(
      db, c.env as Env, tenant(c), await who(c),
      rowId(c.req.param('id')), String(body.status ?? '') as ReservationStatus,
    ));
  }));

  // ── Agency ────────────────────────────────────────────────────────────────

  router.get('/agency', (c) => handle(async () =>
    Response.json({ practices: await listPractices(db, tenant(c)) })));

  router.put('/agency/:agencyRef/branding', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await setBranding(db, tenant(c), {
      agencyRef: c.req.param('agencyRef'),
      name: String(body.name ?? ''),
      logoArtifactId: str(body.logoArtifactId) ?? null,
      theme: body.theme,
      tagline: str(body.tagline) ?? null,
      website: str(body.website) ?? null,
    }));
  }));

  router.get('/agency/:agencyRef/branding', (c) => handle(async () =>
    Response.json({ branding: await branding(db, tenant(c), c.req.param('agencyRef')) })));

  router.get('/agency/:agencyRef/economics', manager, (c) => handle(async () =>
    Response.json({ clients: await clientEconomics(db, tenant(c), c.req.param('agencyRef')) })));

  router.get('/agency/:agencyRef/clients', (c) => handle(async () =>
    Response.json({
      clients: await listClients(db, tenant(c), c.req.param('agencyRef'), c.req.query('status') as ClientStatus | undefined),
    })));

  router.post('/agency/:agencyRef/clients', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await addClient(db, c.env as Env, tenant(c), await who(c), {
      agencyRef: c.req.param('agencyRef'),
      clientName: String(body.clientName ?? ''),
      companyRef: str(body.companyRef) ?? null,
      retainerCents: num(body.retainerCents) ?? null,
      ...(str(body.currency) !== undefined ? { currency: str(body.currency) as string } : {}),
      startedAt: when(body.startedAt) ?? null,
    }), { status: 201 });
  }));

  router.patch('/agency/clients/:id', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await setClientStatus(db, tenant(c), rowId(c.req.param('id')), String(body.status ?? '') as ClientStatus));
  }));

  // ── Consulting ────────────────────────────────────────────────────────────

  router.get('/consulting/decks', (c) => handle(async () =>
    Response.json({ decks: await listDecks(db, tenant(c), c.req.query('visibility') as DeckVisibility | undefined) })));

  router.put('/consulting/decks', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await saveDeck(db, c.env as Env, tenant(c), await who(c), {
      ...(num(body.id) !== undefined ? { id: num(body.id) as number } : {}),
      slug: String(body.slug ?? ''),
      name: String(body.name ?? ''),
      description: str(body.description) ?? null,
      cards: Array.isArray(body.cards) ? body.cards : [],
      ...(num(body.priceCents) !== undefined ? { priceCents: num(body.priceCents) as number } : {}),
      ...(str(body.currency) !== undefined ? { currency: str(body.currency) as string } : {}),
      ...(str(body.visibility) !== undefined ? { visibility: str(body.visibility) as DeckVisibility } : {}),
    }));
  }));

  router.get('/consulting/:consultantRef/consultations', (c) => handle(async () =>
    Response.json({ consultations: await consultationsFor(db, tenant(c), c.req.param('consultantRef')) })));

  router.get('/consulting/:consultantRef/knowledge', (c) => handle(async () =>
    Response.json({ docs: await knowledgeDocsFor(db, tenant(c), c.req.param('consultantRef')) })));

  router.post('/consulting/:consultantRef/knowledge', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await publishKnowledgeDoc(db, c.env as Env, tenant(c), await who(c), {
      consultantRef: c.req.param('consultantRef'),
      title: String(body.title ?? ''),
      summary: str(body.summary) ?? null,
      artifactId: str(body.artifactId) ?? null,
    }), { status: 201 });
  }));

  router.post('/consulting/consultations', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await recordConsultation(db, tenant(c), {
      consultantRef: String(body.consultantRef ?? ''),
      clientRef: str(body.clientRef) ?? null,
      reservationId: num(body.reservationId) ?? null,
      topic: str(body.topic) ?? null,
      durationMin: num(body.durationMin) ?? null,
      rateCents: num(body.rateCents) ?? null,
      ...(str(body.currency) !== undefined ? { currency: str(body.currency) as string } : {}),
    }), { status: 201 });
  }));

  router.patch('/consulting/consultations/:id', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await setConsultationStatus(
      db, c.env as Env, tenant(c), await who(c),
      rowId(c.req.param('id')), String(body.status ?? '') as ConsultationStatus,
      str(body.recordingArtifactId) ?? null,
    ));
  }));

  // ── AI operations ─────────────────────────────────────────────────────────

  router.get('/ai/tools', (c) => handle(async () =>
    Response.json({ tools: await toolUsage(db, tenant(c)) })));

  router.get('/ai/tools/:runRef', (c) => handle(async () =>
    Response.json({ calls: await callsForRun(db, tenant(c), c.req.param('runRef')) })));

  router.post('/ai/tools', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await recordToolCall(db, tenant(c), {
      toolName: String(body.toolName ?? ''),
      ...(str(body.outcome) !== undefined ? { outcome: str(body.outcome) as ToolOutcome } : {}),
      runRef: str(body.runRef) ?? null,
      messageRef: str(body.messageRef) ?? null,
      arguments: body.arguments,
      result: body.result,
    }), { status: 201 });
  }));

  router.get('/ai/classifications', (c) => handle(async () =>
    Response.json({ mix: await classificationMix(db, tenant(c)) })));

  router.get('/ai/classifications/:messageRef', (c) => handle(async () =>
    Response.json({ labels: await labelsFor(db, tenant(c), c.req.param('messageRef')) })));

  router.post('/ai/classifications', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await classifyMessage(db, tenant(c), {
      messageRef: String(body.messageRef ?? ''),
      label: String(body.label ?? ''),
      confidence: num(body.confidence) ?? null,
      intent: str(body.intent) ?? null,
      entities: body.entities,
      model: String(body.model ?? ''),
    }), { status: 201 });
  }));

  router.get('/ai/competitors', (c) => handle(async () =>
    Response.json({ competitors: await listCompetitors(db, tenant(c), c.req.query('category')) })));

  router.put('/ai/competitors', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await upsertCompetitor(db, tenant(c), {
      ...(num(body.id) !== undefined ? { id: num(body.id) as number } : {}),
      name: String(body.name ?? ''),
      website: str(body.website) ?? null,
      category: str(body.category) ?? null,
      positioning: str(body.positioning) ?? null,
      strengths: body.strengths,
      weaknesses: body.weaknesses,
    }));
  }));

  router.get('/ai/cache-savings', manager, (c) => handle(async () =>
    Response.json({ providers: await cacheSavings(db, tenant(c)) })));

  router.delete('/ai/cache-expired', manager, (c) => handle(async () =>
    Response.json(await purgeExpired(db, tenant(c)))));

  // ── People ────────────────────────────────────────────────────────────────

  router.get('/people/dimensions', (c) => handle(async () =>
    Response.json({ dimensions: await listDimensions(db, tenant(c)) })));

  router.put('/people/dimensions', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await upsertDimension(db, tenant(c), {
      key: String(body.key ?? ''),
      label: String(body.label ?? ''),
      description: str(body.description) ?? null,
      ...(num(body.weight) !== undefined ? { weight: num(body.weight) as number } : {}),
      benchmark: num(body.benchmark) ?? null,
      ...(num(body.position) !== undefined ? { position: num(body.position) as number } : {}),
    }));
  }));

  router.post('/people/health-score', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await weightedScore(db, tenant(c), (body.scores ?? {}) as Record<string, number>));
  }));

  router.get('/people/employees/:id/emergency-contacts', manager, (c) => handle(async () =>
    Response.json({ contacts: await emergencyContactsFor(db, tenant(c), rowId(c.req.param('id'))) })));

  router.post('/people/employees/:id/emergency-contacts', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await setEmergencyContact(db, tenant(c), rowId(c.req.param('id')), {
      name: String(body.name ?? ''),
      relationship: str(body.relationship) ?? null,
      phone: str(body.phone) ?? null,
      email: str(body.email) ?? null,
      ...(typeof body.isPrimary === 'boolean' ? { isPrimary: body.isPrimary } : {}),
    }), { status: 201 });
  }));

  router.delete('/people/emergency-contacts/:id', manager, (c) => handle(async () =>
    Response.json(await deleteEmergencyContact(db, tenant(c), rowId(c.req.param('id'))))));

  router.get('/people/cohorts', (c) => handle(async () => {
    const periodDays = c.req.query('periodDays');
    if (periodDays) {
      return Response.json({ cohorts: await cohortComparison(db, tenant(c), Number(periodDays)) });
    }
    return Response.json({ horizons: await retentionByHorizon(db, tenant(c)) });
  }));

  router.get('/people/cohorts/:cohortKey', (c) => handle(async () =>
    Response.json({ curve: await cohortCurve(db, tenant(c), c.req.param('cohortKey')) })));

  router.post('/people/cohorts', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const cohortStartedAt = when(body.cohortStartedAt);
    if (!cohortStartedAt) throw new PeopleInsightError('cohortStartedAt is required', 400);
    return Response.json(await recordCohort(db, tenant(c), {
      cohortKey: String(body.cohortKey ?? ''),
      cohortStartedAt,
      periodDays: num(body.periodDays) ?? 0,
      startingCount: num(body.startingCount) ?? 0,
      retainedCount: num(body.retainedCount) ?? 0,
    }), { status: 201 });
  }));

  // ── Portfolio ─────────────────────────────────────────────────────────────

  router.get('/portfolio/modules', (c) => handle(async () => {
    const rung = c.req.query('rung');
    return Response.json({
      modules: rung ? await visibleModules(db, tenant(c), Number(rung)) : await allModules(db, tenant(c)),
    });
  }));

  router.get('/portfolio/modules/ladder', manager, (c) => handle(async () =>
    Response.json({ ladder: await rungLadder(db, tenant(c)) })));

  router.put('/portfolio/modules', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await upsertModule(db, tenant(c), {
      key: String(body.key ?? ''),
      name: String(body.name ?? ''),
      description: str(body.description) ?? null,
      domain: str(body.domain) ?? null,
      ...(num(body.requiredRung) !== undefined ? { requiredRung: num(body.requiredRung) as number } : {}),
      ...(num(body.position) !== undefined ? { position: num(body.position) as number } : {}),
    }));
  }));

  router.get('/portfolio/companies/:id/comparables', (c) => handle(async () =>
    Response.json({
      comparables: await comparablesFor(db, tenant(c), rowId(c.req.param('id'))),
      spread: await comparableSpread(db, tenant(c), rowId(c.req.param('id'))),
    })));

  router.get('/portfolio/companies/:id/valuation', (c) => handle(async () =>
    Response.json(await impliedValuation(db, tenant(c), rowId(c.req.param('id'))))));

  router.post('/portfolio/companies/:id/comparables', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await addComparable(db, tenant(c), rowId(c.req.param('id')), {
      peerName: String(body.peerName ?? ''),
      sector: str(body.sector) ?? null,
      revenue: num(body.revenue) ?? null,
      growthRate: num(body.growthRate) ?? null,
      multiple: num(body.multiple) ?? null,
    }), { status: 201 });
  }));

  router.get('/portfolio/pads/:padObjectId', (c) => handle(async () =>
    Response.json({ attachments: await padAttachments(db, tenant(c), c.req.param('padObjectId')) })));

  router.post('/portfolio/pads/:padObjectId', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await attachToPad(db, tenant(c), {
      padObjectId: c.req.param('padObjectId'),
      artifactId: str(body.artifactId) ?? null,
      label: str(body.label) ?? null,
      placement: body.placement,
      addedBy: (c.get('userId') as string | undefined) ?? null,
    }), { status: 201 });
  }));

  router.patch('/portfolio/attachments/:id', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await updateAttachment(db, tenant(c), rowId(c.req.param('id')), {
      ...(body.label !== undefined ? { label: str(body.label) ?? null } : {}),
      ...(body.placement !== undefined ? { placement: body.placement } : {}),
    }));
  }));

  router.delete('/portfolio/attachments/:id', (c) => handle(async () =>
    Response.json(await detach(db, tenant(c), rowId(c.req.param('id'))))));

  // ── Customer surface ──────────────────────────────────────────────────────

  router.get('/support/articles', (c) => handle(async () =>
    Response.json({
      articles: await listArticles(db, tenant(c), {
        ...(c.req.query('status') ? { status: c.req.query('status') as ArticleStatus } : {}),
        ...(c.req.query('category') ? { category: c.req.query('category') as string } : {}),
      }),
    })));

  router.post('/support/articles', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await createArticle(db, c.env as Env, tenant(c), await who(c), {
      slug: String(body.slug ?? ''),
      title: String(body.title ?? ''),
      summary: str(body.summary) ?? null,
      body: str(body.body) ?? null,
      ...(str(body.kind) !== undefined ? { kind: str(body.kind) as string } : {}),
      category: str(body.category) ?? null,
      tags: body.tags,
      ...(str(body.visibility) !== undefined ? { visibility: str(body.visibility) as ArticleVisibility } : {}),
      ownerRef: str(body.ownerRef) ?? (c.get('userId') as string | undefined) ?? null,
    }), { status: 201 });
  }));

  router.patch('/support/articles/:id/status', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await setArticleStatus(db, tenant(c), rowId(c.req.param('id')), String(body.status ?? '') as ArticleStatus));
  }));

  router.patch('/support/articles/:id/visibility', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await setArticleVisibility(
      db, c.env as Env, tenant(c), await who(c),
      rowId(c.req.param('id')), String(body.visibility ?? '') as ArticleVisibility,
    ));
  }));

  router.get('/support/widgets', (c) => handle(async () =>
    Response.json({ widgets: await listWidgets(db, tenant(c)) })));

  router.put('/support/widgets/:key', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await upsertWidget(db, tenant(c), {
      key: c.req.param('key'),
      name: String(body.name ?? ''),
      ...(str(body.kind) !== undefined ? { kind: str(body.kind) as WidgetKind } : {}),
      questionSetId: str(body.questionSetId) ?? null,
      placement: body.placement,
      audience: body.audience,
      theme: body.theme,
      ...(num(body.cooldownDays) !== undefined ? { cooldownDays: num(body.cooldownDays) as number } : {}),
      ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
    }));
  }));

  router.get('/support/widgets/:key/should-prompt', (c) => handle(async () => {
    const last = when(c.req.query('lastRespondedAt'));
    return Response.json(await shouldPrompt(db, tenant(c), c.req.param('key'), last ?? null));
  }));

  router.post('/support/widgets/:key/response', (c) => handle(async () => {
    await countWidgetResponse(db, tenant(c), c.req.param('key'));
    return new Response(null, { status: 204 });
  }));

  router.get('/support/monitors', (c) => handle(async () =>
    Response.json({ monitors: await listMonitors(db, tenant(c)) })));

  router.put('/support/monitors', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await upsertMonitor(db, tenant(c), {
      ...(num(body.id) !== undefined ? { id: num(body.id) as number } : {}),
      name: String(body.name ?? ''),
      ...(str(body.kind) !== undefined ? { kind: str(body.kind) as MonitorKind } : {}),
      target: String(body.target ?? ''),
      ...(str(body.method) !== undefined ? { method: str(body.method) as string } : {}),
      ...(num(body.expectStatus) !== undefined ? { expectStatus: num(body.expectStatus) as number } : {}),
      expectBody: str(body.expectBody) ?? null,
      ...(num(body.intervalSec) !== undefined ? { intervalSec: num(body.intervalSec) as number } : {}),
      ...(num(body.timeoutMs) !== undefined ? { timeoutMs: num(body.timeoutMs) as number } : {}),
      ...(num(body.failThreshold) !== undefined ? { failThreshold: num(body.failThreshold) as number } : {}),
      regions: body.regions,
      ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
    }));
  }));

  router.post('/support/monitors/:id/probe', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    if (typeof body.ok !== 'boolean') throw new CustomerSurfaceError('ok must be true or false', 400);
    return Response.json(await evaluateProbe(db, tenant(c), rowId(c.req.param('id')), {
      ok: body.ok,
      consecutiveFailures: num(body.consecutiveFailures) ?? 0,
    }));
  }));

  return router;
}

/**
 * The public help centre. No session — a customer reading documentation does not
 * have one. `publicArticles` requires published AND public inside the query, so
 * this route cannot leak an internal runbook however it is called.
 */
export function createPublicSupportRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  const tenantParam = (raw: string): number => {
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0) throw new CustomerSurfaceError('That is not a workspace id.', 400);
    return Math.floor(id);
  };

  router.get('/:tenantId/help', (c) => handle(async () =>
    Response.json({
      articles: await publicArticles(db, tenantParam(c.req.param('tenantId')), c.req.query('category')),
    })));

  router.get('/:tenantId/help/:slug', (c) => handle(async () => {
    const article = await publicArticle(db, tenantParam(c.req.param('tenantId')), c.req.param('slug'));
    if (!article) return Response.json({ error: 'No published article at that address.' }, { status: 404 });
    return Response.json(article);
  }));

  return router;
}
