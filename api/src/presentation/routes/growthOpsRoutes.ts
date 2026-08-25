/**
 * Experimentation, journeys, content, page insight, waitlists, onboarding and the
 * platform vocabularies (PRD 19 §9).
 *
 * One router because these are the CMO's and the shell's operating surface, and
 * splitting seven small owners across seven mounts buys nothing but seven mounts.
 * Each section keeps its own service; this only translates HTTP.
 *
 *   /api/growth-ops/tests…            A/B tests, variants, segments, results
 *   /api/growth-ops/journeys…         journeys, touchpoints, funnel, attribution
 *   /api/growth-ops/brand…            brand kits
 *   /api/growth-ops/content…          content items and the pipeline
 *   /api/growth-ops/emails…           templates addressed by key
 *   /api/growth-ops/nurture…          flow definitions (not the runner)
 *   /api/growth-ops/learn…            videos attached to surfaces
 *   /api/growth-ops/podcasts…         outreach pipeline
 *   /api/growth-ops/heatmaps…         maps, screenshots, which pages are readable
 *   /api/growth-ops/embeds…           widget placement
 *   /api/growth-ops/waitlist…         both lists, one status machine
 *   /api/growth-ops/onboarding…       flows, steps, progress, funnel
 *   /api/growth-ops/vocabulary…       stages and countries
 *
 * Recording an exposure, a conversion, a touchpoint or a waitlist join is MEMBER
 * — these are high-volume writes from surfaces, not assertions about the
 * business. Defining a test, allocating traffic, publishing a flow or opening a
 * region is MANAGER.
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { resolveActorFromContext } from '../../application/activity/activityLog';
import {
  ExperimentError,
  addSegment,
  channelAttribution,
  createJourney,
  createTest,
  journeyFunnel,
  listJourneys,
  listTests,
  recordConversion,
  recordExposure,
  recordTouchpoint,
  setVariants,
  startTest,
  stopTest,
  variantResults,
  type TestStatus,
} from '../../application/marketing/experimentation';
import {
  ContentError,
  advanceOutreach,
  attachLearnVideo,
  contentPipeline,
  createBrandKit,
  createContentItem,
  defaultBrandKit,
  emailByKey,
  listBrandKits,
  listContent,
  listEmails,
  listNurtureFlows,
  outreachPipeline,
  recordOutreach,
  saveNurtureFlow,
  setDefaultBrandKit,
  upsertEmail,
  videosForSurface,
  type FlowStatus,
  type OutreachStatus,
} from '../../application/marketing/contentStudio';
import {
  PageInsightError,
  addScreenshot,
  heatmapFor,
  heatmapHistory,
  layoutFor,
  listEmbedLayouts,
  readablePages,
  screenshotFor,
  setEmbedLayout,
  storeHeatmap,
  type EmbedMode,
} from '../../application/marketing/pageInsight';
import {
  WaitlistError,
  conversionFunnel,
  inviteFromList,
  inviteRegion,
  joinList,
  joinRegion,
  listEntries,
  markOutcome,
  regionDemand,
  waitlistOverview,
  type WaitlistStatus,
} from '../../application/marketing/waitlist';
import {
  OnboardingError,
  addChecklist,
  addTask,
  completeFlow,
  createFlow,
  flowDefinition,
  flowFunnel,
  flowProgress,
  flowsForAudience,
  setProgress,
  type Audience,
  type ProgressStatus,
} from '../../application/tenant/onboardingFlows';
import { countries, stages, supportedCountries } from '../../application/kernel/platformVocabulary';

const handle = async (run: () => Promise<Response>): Promise<Response> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ExperimentError || error instanceof ContentError
      || error instanceof PageInsightError || error instanceof WaitlistError
      || error instanceof OnboardingError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
};

const rowId = (raw: string): number => {
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) throw new ExperimentError('That is not an id.', 400);
  return Math.floor(id);
};

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const when = (v: unknown): Date | undefined => {
  const s = str(v);
  if (!s) return undefined;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new ExperimentError('That is not a date.', 400);
  return d;
};

export function createGrowthOpsRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  const manager = requireRole(TenantRole.MANAGER);
  const tenant = (c: { get: (k: string) => unknown }) => c.get('tenantId') as number;
  const who = async (c: Parameters<typeof resolveActorFromContext>[2] & { env: unknown }) =>
    resolveActorFromContext(c.env as Env, db, c);

  // ── Vocabulary ────────────────────────────────────────────────────────────

  router.get('/vocabulary/stages', (c) => handle(async () =>
    Response.json({ stages: await stages(db, c.env as Env, c.req.query('category') ?? 'company') })));

  router.get('/vocabulary/countries', (c) => handle(async () =>
    Response.json({
      countries: c.req.query('supported') === '1'
        ? await supportedCountries(db, c.env as Env)
        : await countries(db, c.env as Env),
    })));

  // ── A/B tests ─────────────────────────────────────────────────────────────

  router.get('/tests', (c) => handle(async () =>
    Response.json({ tests: await listTests(db, tenant(c), c.req.query('status') as TestStatus | undefined) })));

  router.post('/tests', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await createTest(db, tenant(c), {
      key: String(body.key ?? ''),
      name: String(body.name ?? ''),
      hypothesis: str(body.hypothesis) ?? null,
      primaryMetric: str(body.primaryMetric) ?? null,
      minimumSample: num(body.minimumSample) ?? null,
    }), { status: 201 });
  }));

  router.get('/tests/:id/results', (c) => handle(async () =>
    Response.json(await variantResults(db, tenant(c), rowId(c.req.param('id'))))));

  router.put('/tests/:id/variants', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const raw = Array.isArray(body.variants) ? body.variants : [];
    return Response.json({
      variants: await setVariants(db, tenant(c), rowId(c.req.param('id')), raw.map((v) => {
        const o = v as Record<string, unknown>;
        return {
          key: String(o.key ?? ''),
          name: String(o.name ?? ''),
          ...(typeof o.isControl === 'boolean' ? { isControl: o.isControl } : {}),
          trafficPercent: num(o.trafficPercent) ?? 0,
          payload: o.payload,
        };
      })),
    });
  }));

  router.post('/tests/:id/segments', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await addSegment(db, tenant(c), rowId(c.req.param('id')), {
      name: String(body.name ?? ''),
      rule: (body.rule ?? {}) as Record<string, unknown>,
      ...(typeof body.isExclusion === 'boolean' ? { isExclusion: body.isExclusion } : {}),
    }), { status: 201 });
  }));

  router.post('/tests/:id/start', manager, (c) => handle(async () =>
    Response.json(await startTest(db, c.env as Env, tenant(c), await who(c), rowId(c.req.param('id'))))));

  router.post('/tests/:id/stop', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
    return Response.json(await stopTest(
      db, c.env as Env, tenant(c), await who(c), rowId(c.req.param('id')), body.concluded === true,
    ));
  }));

  router.post('/tests/variants/:variantId/exposure', (c) => handle(async () => {
    await recordExposure(db, tenant(c), rowId(c.req.param('variantId')));
    return new Response(null, { status: 204 });
  }));

  router.post('/tests/variants/:variantId/conversion', (c) => handle(async () => {
    await recordConversion(db, tenant(c), rowId(c.req.param('variantId')));
    return new Response(null, { status: 204 });
  }));

  // ── Journeys ──────────────────────────────────────────────────────────────

  router.get('/journeys/attribution', (c) => handle(async () => {
    const journeyId = c.req.query('journeyId');
    return Response.json({
      channels: await channelAttribution(db, tenant(c), journeyId ? Number(journeyId) : undefined),
    });
  }));

  router.get('/journeys', (c) => handle(async () =>
    Response.json({ journeys: await listJourneys(db, tenant(c)) })));

  router.post('/journeys', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await createJourney(db, tenant(c), {
      name: String(body.name ?? ''),
      persona: str(body.persona) ?? null,
      stages: Array.isArray(body.stages) ? body.stages.map((s) => String(s)) : [],
      description: str(body.description) ?? null,
    }), { status: 201 });
  }));

  router.get('/journeys/:id/funnel', (c) => handle(async () =>
    Response.json(await journeyFunnel(db, tenant(c), rowId(c.req.param('id'))))));

  router.post('/journeys/:id/touchpoints', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const occurredAt = when(body.occurredAt);
    return Response.json(await recordTouchpoint(db, tenant(c), {
      journeyId: rowId(c.req.param('id')),
      stage: String(body.stage ?? ''),
      subjectRef: str(body.subjectRef) ?? null,
      visitorId: str(body.visitorId) ?? null,
      channel: str(body.channel) ?? null,
      label: str(body.label) ?? null,
      attribution: num(body.attribution) ?? null,
      ...(occurredAt ? { occurredAt } : {}),
    }), { status: 201 });
  }));

  // ── Brand and content ─────────────────────────────────────────────────────

  router.get('/brand/default', (c) => handle(async () =>
    Response.json({ brandKit: await defaultBrandKit(db, tenant(c)) })));

  router.get('/brand', (c) => handle(async () =>
    Response.json({ brandKits: await listBrandKits(db, tenant(c)) })));

  router.post('/brand', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await createBrandKit(db, tenant(c), {
      name: String(body.name ?? ''),
      palette: body.palette,
      typography: body.typography,
      voice: str(body.voice) ?? null,
      logoArtifactId: str(body.logoArtifactId) ?? null,
      logoDarkArtifactId: str(body.logoDarkArtifactId) ?? null,
    }), { status: 201 });
  }));

  router.post('/brand/:id/default', manager, (c) => handle(async () =>
    Response.json(await setDefaultBrandKit(db, tenant(c), rowId(c.req.param('id'))))));

  router.get('/content/pipeline', (c) => handle(async () =>
    Response.json({ pipeline: await contentPipeline(db, tenant(c)) })));

  router.get('/content', (c) => handle(async () => {
    const format = c.req.query('format');
    const channel = c.req.query('channel');
    const ownerRef = c.req.query('ownerRef');
    return Response.json({
      items: await listContent(db, tenant(c), {
        ...(format ? { format } : {}),
        ...(channel ? { channel } : {}),
        ...(ownerRef ? { ownerRef } : {}),
      }),
    });
  }));

  router.post('/content', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await createContentItem(db, c.env as Env, tenant(c), await who(c), {
      title: String(body.title ?? ''),
      format: String(body.format ?? ''),
      channel: str(body.channel) ?? null,
      brief: str(body.brief) ?? null,
      ownerRef: str(body.ownerRef) ?? (c.get('userId') as string | undefined) ?? null,
      artifactId: str(body.artifactId) ?? null,
    }), { status: 201 });
  }));

  // ── Emails and nurture ────────────────────────────────────────────────────

  router.get('/emails', (c) => handle(async () =>
    Response.json({ emails: await listEmails(db, tenant(c)) })));

  router.put('/emails/:key', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await upsertEmail(db, tenant(c), {
      key: c.req.param('key'),
      name: String(body.name ?? ''),
      subject: str(body.subject) ?? null,
      bodyHtml: str(body.bodyHtml) ?? null,
      bodyText: str(body.bodyText) ?? null,
      variables: body.variables,
      ...(typeof body.isTemplate === 'boolean' ? { isTemplate: body.isTemplate } : {}),
    }));
  }));

  router.get('/emails/:key', (c) => handle(async () => {
    const email = await emailByKey(db, tenant(c), c.req.param('key'));
    if (!email) return Response.json({ error: 'No template with that key.' }, { status: 404 });
    return Response.json(email);
  }));

  router.get('/nurture', (c) => handle(async () =>
    Response.json({ flows: await listNurtureFlows(db, tenant(c), c.req.query('status') as FlowStatus | undefined) })));

  router.put('/nurture', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await saveNurtureFlow(db, tenant(c), {
      ...(num(body.id) !== undefined ? { id: num(body.id) as number } : {}),
      name: String(body.name ?? ''),
      goal: str(body.goal) ?? null,
      steps: Array.isArray(body.steps) ? body.steps : [],
      entryRule: body.entryRule,
      exitRule: body.exitRule,
      ...(str(body.status) !== undefined ? { status: str(body.status) as FlowStatus } : {}),
      ownerRef: str(body.ownerRef) ?? null,
    }));
  }));

  // ── Learn videos and podcasts ─────────────────────────────────────────────

  router.get('/learn/:surface', (c) => handle(async () =>
    Response.json({ videos: await videosForSurface(db, tenant(c), c.req.param('surface')) })));

  router.post('/learn', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const videoId = num(body.videoId);
    if (videoId === undefined) throw new ContentError('videoId is required', 400);
    return Response.json(await attachLearnVideo(db, tenant(c), {
      videoId,
      surface: String(body.surface ?? ''),
      title: String(body.title ?? ''),
      featureKey: str(body.featureKey) ?? null,
      ...(num(body.position) !== undefined ? { position: num(body.position) as number } : {}),
    }), { status: 201 });
  }));

  router.get('/podcasts/pipeline', (c) => handle(async () =>
    Response.json({ pipeline: await outreachPipeline(db, tenant(c)) })));

  router.post('/podcasts', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await recordOutreach(db, tenant(c), {
      showName: String(body.showName ?? ''),
      hostName: str(body.hostName) ?? null,
      contactEmail: str(body.contactEmail) ?? null,
      audienceSize: num(body.audienceSize) ?? null,
      topicPitch: str(body.topicPitch) ?? null,
    }), { status: 201 });
  }));

  router.patch('/podcasts/:id', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await advanceOutreach(
      db, c.env as Env, tenant(c), await who(c),
      rowId(c.req.param('id')), String(body.status ?? '') as OutreachStatus,
    ));
  }));

  // ── Heatmaps and embeds ───────────────────────────────────────────────────

  router.get('/heatmaps/readable', (c) => handle(async () =>
    Response.json({ pages: await readablePages(db, tenant(c)) })));

  router.get('/heatmaps', (c) => handle(async () => {
    const path = c.req.query('path');
    if (!path) throw new PageInsightError('path is required', 400);
    return Response.json({
      current: await heatmapFor(db, tenant(c), path),
      history: await heatmapHistory(db, tenant(c), path),
    });
  }));

  router.post('/heatmaps', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const periodStart = when(body.periodStart);
    const periodEnd = when(body.periodEnd);
    if (!periodStart || !periodEnd) throw new PageInsightError('periodStart and periodEnd are required', 400);
    return Response.json(await storeHeatmap(db, tenant(c), {
      path: String(body.path ?? ''),
      clickMap: body.clickMap,
      scrollMap: body.scrollMap,
      sampleCount: num(body.sampleCount) ?? 0,
      periodStart,
      periodEnd,
    }), { status: 201 });
  }));

  router.post('/heatmaps/:id/screenshots', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await addScreenshot(db, tenant(c), rowId(c.req.param('id')), {
      artifactId: str(body.artifactId) ?? null,
      viewportWidth: num(body.viewportWidth) ?? 0,
      viewportHeight: num(body.viewportHeight) ?? null,
      ...(body.themeMode === 'dark' ? { themeMode: 'dark' as const } : {}),
    }), { status: 201 });
  }));

  router.get('/heatmaps/:id/screenshot', (c) => handle(async () => {
    const width = Number(c.req.query('viewportWidth') ?? 0);
    if (!Number.isFinite(width) || width <= 0) throw new PageInsightError('viewportWidth is required', 400);
    return Response.json({
      screenshot: await screenshotFor(
        db, tenant(c), rowId(c.req.param('id')), width,
        c.req.query('themeMode') === 'dark' ? 'dark' : 'light',
      ),
    });
  }));

  router.get('/embeds', (c) => handle(async () =>
    Response.json({ layouts: await listEmbedLayouts(db, tenant(c)) })));

  router.put('/embeds/:widgetKey', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await setEmbedLayout(db, tenant(c), {
      widgetKey: c.req.param('widgetKey'),
      hostPattern: str(body.hostPattern) ?? null,
      ...(str(body.mode) !== undefined ? { mode: str(body.mode) as EmbedMode } : {}),
      config: body.config,
    }));
  }));

  router.get('/embeds/:widgetKey', (c) => handle(async () =>
    Response.json({ layout: await layoutFor(db, tenant(c), c.req.param('widgetKey'), c.req.query('host')) })));

  // ── Waitlist ──────────────────────────────────────────────────────────────

  router.get('/waitlist/overview', (c) => handle(async () =>
    Response.json(await waitlistOverview(db, tenant(c)))));

  router.get('/waitlist/regions', (c) => handle(async () =>
    Response.json({ regions: await regionDemand(db, tenant(c)) })));

  router.get('/waitlist/funnel', (c) => handle(async () =>
    Response.json(await conversionFunnel(db, tenant(c), c.req.query('listKey')))));

  router.post('/waitlist/join', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await joinList(db, tenant(c), {
      listKey: String(body.listKey ?? ''),
      email: String(body.email ?? ''),
      name: str(body.name) ?? null,
      referrer: str(body.referrer) ?? null,
    }), { status: 201 });
  }));

  router.post('/waitlist/regions/join', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await joinRegion(db, tenant(c), {
      email: String(body.email ?? ''),
      country: str(body.country) ?? null,
      region: str(body.region) ?? null,
      source: str(body.source) ?? null,
    }), { status: 201 });
  }));

  router.post('/waitlist/invite', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const emails = Array.isArray(body.emails) ? body.emails.map((e) => String(e)) : [];
    return Response.json(await inviteFromList(
      db, c.env as Env, tenant(c), await who(c), String(body.listKey ?? ''), emails,
    ));
  }));

  router.post('/waitlist/regions/:country/open', manager, (c) => handle(async () =>
    Response.json(await inviteRegion(
      db, c.env as Env, tenant(c), await who(c), c.req.param('country'),
    ))));

  router.post('/waitlist/outcome', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const outcome = str(body.outcome);
    if (outcome !== 'joined' && outcome !== 'declined') {
      throw new WaitlistError("outcome must be 'joined' or 'declined'", 400);
    }
    return Response.json(await markOutcome(db, tenant(c), String(body.email ?? ''), outcome));
  }));

  router.get('/waitlist/:listKey', (c) => handle(async () =>
    Response.json({
      entries: await listEntries(
        db, tenant(c), c.req.param('listKey'), c.req.query('status') as WaitlistStatus | undefined,
      ),
    })));

  // ── Onboarding ────────────────────────────────────────────────────────────

  router.get('/onboarding/flows', (c) => handle(async () =>
    Response.json({
      flows: await flowsForAudience(db, tenant(c), (c.req.query('audience') ?? 'signup') as Audience),
    })));

  router.post('/onboarding/flows', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await createFlow(db, tenant(c), {
      key: String(body.key ?? ''),
      name: String(body.name ?? ''),
      ...(str(body.audience) !== undefined ? { audience: str(body.audience) as Audience } : {}),
      description: str(body.description) ?? null,
    }), { status: 201 });
  }));

  router.get('/onboarding/flows/:id', (c) => handle(async () =>
    Response.json(await flowDefinition(db, tenant(c), rowId(c.req.param('id'))))));

  router.post('/onboarding/flows/:id/checklists', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await addChecklist(db, tenant(c), rowId(c.req.param('id')), {
      name: String(body.name ?? ''),
      summary: str(body.summary) ?? null,
      ...(typeof body.isRequired === 'boolean' ? { isRequired: body.isRequired } : {}),
    }), { status: 201 });
  }));

  router.post('/onboarding/checklists/:id/tasks', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await addTask(db, tenant(c), rowId(c.req.param('id')), {
      key: String(body.key ?? ''),
      title: String(body.title ?? ''),
      description: str(body.description) ?? null,
      actionHref: str(body.actionHref) ?? null,
      ...(body.completionKind === 'event' || body.completionKind === 'query'
        ? { completionKind: body.completionKind }
        : {}),
      completionRule: body.completionRule,
      ...(typeof body.isRequired === 'boolean' ? { isRequired: body.isRequired } : {}),
    }), { status: 201 });
  }));

  router.get('/onboarding/flows/:id/funnel', manager, (c) => handle(async () =>
    Response.json({ steps: await flowFunnel(db, tenant(c), rowId(c.req.param('id'))) })));

  router.get('/onboarding/flows/:id/progress', (c) => handle(async () =>
    Response.json(await flowProgress(
      db, tenant(c), rowId(c.req.param('id')),
      c.req.query('subjectRef') ?? String(c.get('userId') ?? ''),
    ))));

  router.put('/onboarding/progress', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const flowId = num(body.flowId);
    const taskId = num(body.taskId);
    if (flowId === undefined || taskId === undefined) {
      throw new OnboardingError('flowId and taskId are required', 400);
    }
    return Response.json(await setProgress(db, tenant(c), {
      flowId,
      taskId,
      subjectRef: str(body.subjectRef) ?? String(c.get('userId') ?? ''),
      status: String(body.status ?? '') as ProgressStatus,
      skippedReason: str(body.skippedReason) ?? null,
    }));
  }));

  router.post('/onboarding/flows/:id/skip', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
    return Response.json(await completeFlow(
      db, c.env as Env, tenant(c), await who(c), rowId(c.req.param('id')),
      str(body.subjectRef) ?? String(c.get('userId') ?? ''),
      str(body.reason) ?? 'skipped by the user',
    ));
  }));

  return router;
}
