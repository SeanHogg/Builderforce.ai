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
import { parseBody } from './requestBody';
import {
  AddClientBody,
  AddHostBody,
  ArticleBody,
  ArticleVisibilityBody,
  AttachmentPatchBody,
  BrandingBody,
  ClassificationBody,
  CohortBody,
  ComparableBody,
  CompetitorBody,
  ConsultationBody,
  ConsultationStatusBody,
  CreateServiceBody,
  DimensionBody,
  EmergencyContactBody,
  HealthScoreBody,
  KnowledgeDocBody,
  ModuleBody,
  MonitorBody,
  PadAttachmentBody,
  ProbeBody,
  ReserveBody,
  SaveDeckBody,
  StatusBody,
  ToolCallBody,
  WidgetBody,
} from './practiceOpsRoutes.schemas';

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

const when = (s: string | null | undefined): Date | undefined => {
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
    const body = await parseBody(c, CreateServiceBody);
    return Response.json(await createService(db, tenant(c), {
      slug: String(body.slug ?? ''),
      name: String(body.name ?? ''),
      description: body.description ?? null,
      ...(body.durationMin != null ? { durationMin: body.durationMin } : {}),
      ...(body.bufferMin != null ? { bufferMin: body.bufferMin } : {}),
      ...(body.priceCents != null ? { priceCents: body.priceCents } : {}),
      ...(body.currency != null ? { currency: body.currency } : {}),
      ...(body.mode != null ? { mode: body.mode as BookingMode } : {}),
      ...(body.capacity != null ? { capacity: body.capacity } : {}),
    }), { status: 201 });
  }));

  router.get('/booking/services/:id/hosts', (c) => handle(async () =>
    Response.json({ hosts: await serviceHosts(db, tenant(c), rowId(c.req.param('id'))) })));

  router.post('/booking/services/:id/hosts', manager, (c) => handle(async () => {
    const body = await parseBody(c, AddHostBody);
    return Response.json(await addHost(db, tenant(c), rowId(c.req.param('id')), {
      hostRef: String(body.hostRef ?? ''),
      ...(body.timezone != null ? { timezone: body.timezone } : {}),
      ...(body.priority != null ? { priority: body.priority } : {}),
      connectionId: body.connectionId ?? null,
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
    const body = await parseBody(c, ReserveBody);
    const startsAt = when(body.startsAt);
    const serviceId = body.serviceId;
    if (!startsAt || serviceId == null) throw new BookingError('serviceId and startsAt are required', 400);
    return Response.json(await reserve(db, c.env as Env, tenant(c), await who(c), {
      serviceId,
      startsAt,
      hostRef: body.hostRef ?? null,
      bookerRef: body.bookerRef ?? (c.get('userId') as string | undefined) ?? null,
      bookerEmail: body.bookerEmail ?? null,
      ...(body.timezone != null ? { timezone: body.timezone } : {}),
    }), { status: 201 });
  }));

  router.patch('/booking/reservations/:id', (c) => handle(async () => {
    const body = await parseBody(c, StatusBody);
    return Response.json(await setReservationStatus(
      db, c.env as Env, tenant(c), await who(c),
      rowId(c.req.param('id')), String(body.status ?? '') as ReservationStatus,
    ));
  }));

  // ── Agency ────────────────────────────────────────────────────────────────

  router.get('/agency', (c) => handle(async () =>
    Response.json({ practices: await listPractices(db, tenant(c)) })));

  router.put('/agency/:agencyRef/branding', manager, (c) => handle(async () => {
    const body = await parseBody(c, BrandingBody);
    return Response.json(await setBranding(db, tenant(c), {
      agencyRef: c.req.param('agencyRef'),
      name: String(body.name ?? ''),
      logoArtifactId: body.logoArtifactId ?? null,
      theme: body.theme,
      tagline: body.tagline ?? null,
      website: body.website ?? null,
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
    const body = await parseBody(c, AddClientBody);
    return Response.json(await addClient(db, c.env as Env, tenant(c), await who(c), {
      agencyRef: c.req.param('agencyRef'),
      clientName: String(body.clientName ?? ''),
      companyRef: body.companyRef ?? null,
      retainerCents: body.retainerCents ?? null,
      ...(body.currency != null ? { currency: body.currency } : {}),
      startedAt: when(body.startedAt) ?? null,
    }), { status: 201 });
  }));

  router.patch('/agency/clients/:id', manager, (c) => handle(async () => {
    const body = await parseBody(c, StatusBody);
    return Response.json(await setClientStatus(db, tenant(c), rowId(c.req.param('id')), String(body.status ?? '') as ClientStatus));
  }));

  // ── Consulting ────────────────────────────────────────────────────────────

  router.get('/consulting/decks', (c) => handle(async () =>
    Response.json({ decks: await listDecks(db, tenant(c), c.req.query('visibility') as DeckVisibility | undefined) })));

  router.put('/consulting/decks', manager, (c) => handle(async () => {
    const body = await parseBody(c, SaveDeckBody);
    return Response.json(await saveDeck(db, c.env as Env, tenant(c), await who(c), {
      ...(body.id != null ? { id: body.id } : {}),
      slug: String(body.slug ?? ''),
      name: String(body.name ?? ''),
      description: body.description ?? null,
      cards: body.cards ?? [],
      ...(body.priceCents != null ? { priceCents: body.priceCents } : {}),
      ...(body.currency != null ? { currency: body.currency } : {}),
      ...(body.visibility != null ? { visibility: body.visibility as DeckVisibility } : {}),
    }));
  }));

  router.get('/consulting/:consultantRef/consultations', (c) => handle(async () =>
    Response.json({ consultations: await consultationsFor(db, tenant(c), c.req.param('consultantRef')) })));

  router.get('/consulting/:consultantRef/knowledge', (c) => handle(async () =>
    Response.json({ docs: await knowledgeDocsFor(db, tenant(c), c.req.param('consultantRef')) })));

  router.post('/consulting/:consultantRef/knowledge', (c) => handle(async () => {
    const body = await parseBody(c, KnowledgeDocBody);
    return Response.json(await publishKnowledgeDoc(db, c.env as Env, tenant(c), await who(c), {
      consultantRef: c.req.param('consultantRef'),
      title: String(body.title ?? ''),
      summary: body.summary ?? null,
      artifactId: body.artifactId ?? null,
    }), { status: 201 });
  }));

  router.post('/consulting/consultations', (c) => handle(async () => {
    const body = await parseBody(c, ConsultationBody);
    return Response.json(await recordConsultation(db, tenant(c), {
      consultantRef: String(body.consultantRef ?? ''),
      clientRef: body.clientRef ?? null,
      reservationId: body.reservationId ?? null,
      topic: body.topic ?? null,
      durationMin: body.durationMin ?? null,
      rateCents: body.rateCents ?? null,
      ...(body.currency != null ? { currency: body.currency } : {}),
    }), { status: 201 });
  }));

  router.patch('/consulting/consultations/:id', (c) => handle(async () => {
    const body = await parseBody(c, ConsultationStatusBody);
    return Response.json(await setConsultationStatus(
      db, c.env as Env, tenant(c), await who(c),
      rowId(c.req.param('id')), String(body.status ?? '') as ConsultationStatus,
      body.recordingArtifactId ?? null,
    ));
  }));

  // ── AI operations ─────────────────────────────────────────────────────────

  router.get('/ai/tools', (c) => handle(async () =>
    Response.json({ tools: await toolUsage(db, tenant(c)) })));

  router.get('/ai/tools/:runRef', (c) => handle(async () =>
    Response.json({ calls: await callsForRun(db, tenant(c), c.req.param('runRef')) })));

  router.post('/ai/tools', (c) => handle(async () => {
    const body = await parseBody(c, ToolCallBody);
    return Response.json(await recordToolCall(db, tenant(c), {
      toolName: String(body.toolName ?? ''),
      ...(body.outcome != null ? { outcome: body.outcome as ToolOutcome } : {}),
      runRef: body.runRef ?? null,
      messageRef: body.messageRef ?? null,
      arguments: body.arguments,
      result: body.result,
    }), { status: 201 });
  }));

  router.get('/ai/classifications', (c) => handle(async () =>
    Response.json({ mix: await classificationMix(db, tenant(c)) })));

  router.get('/ai/classifications/:messageRef', (c) => handle(async () =>
    Response.json({ labels: await labelsFor(db, tenant(c), c.req.param('messageRef')) })));

  router.post('/ai/classifications', (c) => handle(async () => {
    const body = await parseBody(c, ClassificationBody);
    return Response.json(await classifyMessage(db, tenant(c), {
      messageRef: String(body.messageRef ?? ''),
      label: String(body.label ?? ''),
      confidence: body.confidence ?? null,
      intent: body.intent ?? null,
      entities: body.entities,
      model: String(body.model ?? ''),
    }), { status: 201 });
  }));

  router.get('/ai/competitors', (c) => handle(async () =>
    Response.json({ competitors: await listCompetitors(db, tenant(c), c.req.query('category')) })));

  router.put('/ai/competitors', manager, (c) => handle(async () => {
    const body = await parseBody(c, CompetitorBody);
    return Response.json(await upsertCompetitor(db, tenant(c), {
      ...(body.id != null ? { id: body.id } : {}),
      name: String(body.name ?? ''),
      website: body.website ?? null,
      category: body.category ?? null,
      positioning: body.positioning ?? null,
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
    const body = await parseBody(c, DimensionBody);
    return Response.json(await upsertDimension(db, tenant(c), {
      key: String(body.key ?? ''),
      label: String(body.label ?? ''),
      description: body.description ?? null,
      ...(body.weight != null ? { weight: body.weight } : {}),
      benchmark: body.benchmark ?? null,
      ...(body.position != null ? { position: body.position } : {}),
    }));
  }));

  router.post('/people/health-score', (c) => handle(async () => {
    const body = await parseBody(c, HealthScoreBody);
    return Response.json(await weightedScore(db, tenant(c), body.scores ?? {}));
  }));

  router.get('/people/employees/:id/emergency-contacts', manager, (c) => handle(async () =>
    Response.json({ contacts: await emergencyContactsFor(db, tenant(c), rowId(c.req.param('id'))) })));

  router.post('/people/employees/:id/emergency-contacts', manager, (c) => handle(async () => {
    const body = await parseBody(c, EmergencyContactBody);
    return Response.json(await setEmergencyContact(db, tenant(c), rowId(c.req.param('id')), {
      name: String(body.name ?? ''),
      relationship: body.relationship ?? null,
      phone: body.phone ?? null,
      email: body.email ?? null,
      ...(body.isPrimary != null ? { isPrimary: body.isPrimary } : {}),
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
    const body = await parseBody(c, CohortBody);
    const cohortStartedAt = when(body.cohortStartedAt);
    if (!cohortStartedAt) throw new PeopleInsightError('cohortStartedAt is required', 400);
    return Response.json(await recordCohort(db, tenant(c), {
      cohortKey: String(body.cohortKey ?? ''),
      cohortStartedAt,
      periodDays: body.periodDays ?? 0,
      startingCount: body.startingCount ?? 0,
      retainedCount: body.retainedCount ?? 0,
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
    const body = await parseBody(c, ModuleBody);
    return Response.json(await upsertModule(db, tenant(c), {
      key: String(body.key ?? ''),
      name: String(body.name ?? ''),
      description: body.description ?? null,
      domain: body.domain ?? null,
      ...(body.requiredRung != null ? { requiredRung: body.requiredRung } : {}),
      ...(body.position != null ? { position: body.position } : {}),
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
    const body = await parseBody(c, ComparableBody);
    return Response.json(await addComparable(db, tenant(c), rowId(c.req.param('id')), {
      peerName: String(body.peerName ?? ''),
      sector: body.sector ?? null,
      revenue: body.revenue ?? null,
      growthRate: body.growthRate ?? null,
      multiple: body.multiple ?? null,
    }), { status: 201 });
  }));

  router.get('/portfolio/pads/:padObjectId', (c) => handle(async () =>
    Response.json({ attachments: await padAttachments(db, tenant(c), c.req.param('padObjectId')) })));

  router.post('/portfolio/pads/:padObjectId', (c) => handle(async () => {
    const body = await parseBody(c, PadAttachmentBody);
    return Response.json(await attachToPad(db, tenant(c), {
      padObjectId: c.req.param('padObjectId'),
      artifactId: body.artifactId ?? null,
      label: body.label ?? null,
      placement: body.placement,
      addedBy: (c.get('userId') as string | undefined) ?? null,
    }), { status: 201 });
  }));

  router.patch('/portfolio/attachments/:id', (c) => handle(async () => {
    const body = await parseBody(c, AttachmentPatchBody);
    return Response.json(await updateAttachment(db, tenant(c), rowId(c.req.param('id')), {
      ...(body.label !== undefined ? { label: body.label } : {}),
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
    const body = await parseBody(c, ArticleBody);
    return Response.json(await createArticle(db, c.env as Env, tenant(c), await who(c), {
      slug: String(body.slug ?? ''),
      title: String(body.title ?? ''),
      summary: body.summary ?? null,
      body: body.body ?? null,
      ...(body.kind != null ? { kind: body.kind } : {}),
      category: body.category ?? null,
      tags: body.tags,
      ...(body.visibility != null ? { visibility: body.visibility as ArticleVisibility } : {}),
      ownerRef: body.ownerRef ?? (c.get('userId') as string | undefined) ?? null,
    }), { status: 201 });
  }));

  router.patch('/support/articles/:id/status', manager, (c) => handle(async () => {
    const body = await parseBody(c, StatusBody);
    return Response.json(await setArticleStatus(db, tenant(c), rowId(c.req.param('id')), String(body.status ?? '') as ArticleStatus));
  }));

  router.patch('/support/articles/:id/visibility', manager, (c) => handle(async () => {
    const body = await parseBody(c, ArticleVisibilityBody);
    return Response.json(await setArticleVisibility(
      db, c.env as Env, tenant(c), await who(c),
      rowId(c.req.param('id')), String(body.visibility ?? '') as ArticleVisibility,
    ));
  }));

  router.get('/support/widgets', (c) => handle(async () =>
    Response.json({ widgets: await listWidgets(db, tenant(c)) })));

  router.put('/support/widgets/:key', manager, (c) => handle(async () => {
    const body = await parseBody(c, WidgetBody);
    return Response.json(await upsertWidget(db, tenant(c), {
      key: c.req.param('key'),
      name: String(body.name ?? ''),
      ...(body.kind != null ? { kind: body.kind as WidgetKind } : {}),
      questionSetId: body.questionSetId ?? null,
      placement: body.placement,
      audience: body.audience,
      theme: body.theme,
      ...(body.cooldownDays != null ? { cooldownDays: body.cooldownDays } : {}),
      ...(body.enabled != null ? { enabled: body.enabled } : {}),
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
    const body = await parseBody(c, MonitorBody);
    return Response.json(await upsertMonitor(db, tenant(c), {
      ...(body.id != null ? { id: body.id } : {}),
      name: String(body.name ?? ''),
      ...(body.kind != null ? { kind: body.kind as MonitorKind } : {}),
      target: String(body.target ?? ''),
      ...(body.method != null ? { method: body.method } : {}),
      ...(body.expectStatus != null ? { expectStatus: body.expectStatus } : {}),
      expectBody: body.expectBody ?? null,
      ...(body.intervalSec != null ? { intervalSec: body.intervalSec } : {}),
      ...(body.timeoutMs != null ? { timeoutMs: body.timeoutMs } : {}),
      ...(body.failThreshold != null ? { failThreshold: body.failThreshold } : {}),
      regions: body.regions,
      ...(body.enabled != null ? { enabled: body.enabled } : {}),
    }));
  }));

  router.post('/support/monitors/:id/probe', (c) => handle(async () => {
    const body = await parseBody(c, ProbeBody);
    if (typeof body.ok !== 'boolean') throw new CustomerSurfaceError('ok must be true or false', 400);
    return Response.json(await evaluateProbe(db, tenant(c), rowId(c.req.param('id')), {
      ok: body.ok,
      consecutiveFailures: body.consecutiveFailures ?? 0,
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
