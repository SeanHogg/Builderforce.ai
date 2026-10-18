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
import { countries, country, stages, supportedCountries } from '../../application/kernel/platformVocabulary';
import { parseBody, parseOptionalBody } from './requestBody';
import {
  BrandKitBody,
  ChecklistBody,
  ContentItemBody,
  CreateTestBody,
  EmailBody,
  EmbedLayoutBody,
  FlowBody,
  HeatmapBody,
  InviteBody,
  JoinListBody,
  JoinRegionBody,
  JourneyBody,
  LearnVideoBody,
  NurtureFlowBody,
  OutcomeBody,
  OutreachBody,
  ProgressBody,
  ScreenshotBody,
  SegmentBody,
  SkipFlowBody,
  StatusBody,
  StopTestBody,
  TaskBody,
  TouchpointBody,
  VariantsBody,
} from './growthOpsRoutes.schemas';
import { rowId, whenOrUndefined } from '../../domain/shared/coerce';
import { requireTenantId } from '../middleware/tenantContext';

export function createGrowthOpsRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  const manager = requireRole(TenantRole.MANAGER);
  const tenant = (c: { get: (k: string) => unknown }) => requireTenantId(c);
  const who = async (c: Parameters<typeof resolveActorFromContext>[2] & { env: unknown }) =>
    resolveActorFromContext(c.env as Env, db, c);

  // ── Vocabulary ────────────────────────────────────────────────────────────

  router.get('/vocabulary/stages', async (c) =>
    Response.json({ stages: await stages(db, c.env as Env, c.req.query('category') ?? 'company') }));

  router.get('/vocabulary/countries', async (c) =>
    Response.json({
      countries: c.req.query('supported') === '1'
        ? await supportedCountries(db, c.env as Env)
        : await countries(db, c.env as Env),
    }));

  // ── A/B tests ─────────────────────────────────────────────────────────────

  router.get('/tests', async (c) =>
    Response.json({ tests: await listTests(db, tenant(c), c.req.query('status') as TestStatus | undefined) }));

  router.post('/tests', manager, async (c) => {
    const body = await parseBody(c, CreateTestBody);
    return Response.json(await createTest(db, tenant(c), {
      key: String(body.key ?? ''),
      name: String(body.name ?? ''),
      hypothesis: body.hypothesis ?? null,
      primaryMetric: body.primaryMetric ?? null,
      minimumSample: body.minimumSample ?? null,
    }), { status: 201 });
  });

  router.get('/tests/:id/results', async (c) =>
    Response.json(await variantResults(db, tenant(c), rowId(c.req.param('id')))));

  router.put('/tests/:id/variants', manager, async (c) => {
    const body = await parseBody(c, VariantsBody);
    return Response.json({
      variants: await setVariants(db, tenant(c), rowId(c.req.param('id')), (body.variants ?? []).map((o) => ({
        key: String(o.key ?? ''),
        name: String(o.name ?? ''),
        ...(o.isControl != null ? { isControl: o.isControl } : {}),
        trafficPercent: o.trafficPercent ?? 0,
        payload: o.payload,
      }))),
    });
  });

  router.post('/tests/:id/segments', manager, async (c) => {
    const body = await parseBody(c, SegmentBody);
    return Response.json(await addSegment(db, tenant(c), rowId(c.req.param('id')), {
      name: String(body.name ?? ''),
      rule: body.rule ?? {},
      ...(body.isExclusion != null ? { isExclusion: body.isExclusion } : {}),
    }), { status: 201 });
  });

  router.post('/tests/:id/start', manager, async (c) =>
    Response.json(await startTest(db, c.env as Env, tenant(c), await who(c), rowId(c.req.param('id')))));

  router.post('/tests/:id/stop', manager, async (c) => {
    const body = await parseOptionalBody(c, StopTestBody);
    return Response.json(await stopTest(
      db, c.env as Env, tenant(c), await who(c), rowId(c.req.param('id')), body.concluded === true,
    ));
  });

  router.post('/tests/variants/:variantId/exposure', async (c) => {
    await recordExposure(db, tenant(c), rowId(c.req.param('variantId')));
    return new Response(null, { status: 204 });
  });

  router.post('/tests/variants/:variantId/conversion', async (c) => {
    await recordConversion(db, tenant(c), rowId(c.req.param('variantId')));
    return new Response(null, { status: 204 });
  });

  // ── Journeys ──────────────────────────────────────────────────────────────

  router.get('/journeys/attribution', async (c) => {
    const journeyId = c.req.query('journeyId');
    return Response.json({
      channels: await channelAttribution(db, tenant(c), journeyId ? Number(journeyId) : undefined),
    });
  });

  router.get('/journeys', async (c) =>
    Response.json({ journeys: await listJourneys(db, tenant(c)) }));

  router.post('/journeys', manager, async (c) => {
    const body = await parseBody(c, JourneyBody);
    return Response.json(await createJourney(db, tenant(c), {
      name: String(body.name ?? ''),
      persona: body.persona ?? null,
      stages: (body.stages ?? []).map((s) => String(s)),
      description: body.description ?? null,
    }), { status: 201 });
  });

  router.get('/journeys/:id/funnel', async (c) =>
    Response.json(await journeyFunnel(db, tenant(c), rowId(c.req.param('id')))));

  router.post('/journeys/:id/touchpoints', async (c) => {
    const body = await parseBody(c, TouchpointBody);
    const occurredAt = whenOrUndefined(body.occurredAt);
    return Response.json(await recordTouchpoint(db, tenant(c), {
      journeyId: rowId(c.req.param('id')),
      stage: String(body.stage ?? ''),
      subjectRef: body.subjectRef ?? null,
      visitorId: body.visitorId ?? null,
      channel: body.channel ?? null,
      label: body.label ?? null,
      attribution: body.attribution ?? null,
      ...(occurredAt ? { occurredAt } : {}),
    }), { status: 201 });
  });

  // ── Brand and content ─────────────────────────────────────────────────────

  router.get('/brand/default', async (c) =>
    Response.json({ brandKit: await defaultBrandKit(db, tenant(c)) }));

  router.get('/brand', async (c) =>
    Response.json({ brandKits: await listBrandKits(db, tenant(c)) }));

  router.post('/brand', manager, async (c) => {
    const body = await parseBody(c, BrandKitBody);
    return Response.json(await createBrandKit(db, tenant(c), {
      name: String(body.name ?? ''),
      palette: body.palette,
      typography: body.typography,
      voice: body.voice ?? null,
      logoArtifactId: body.logoArtifactId ?? null,
      logoDarkArtifactId: body.logoDarkArtifactId ?? null,
    }), { status: 201 });
  });

  router.post('/brand/:id/default', manager, async (c) =>
    Response.json(await setDefaultBrandKit(db, tenant(c), rowId(c.req.param('id')))));

  router.get('/content/pipeline', async (c) =>
    Response.json({ pipeline: await contentPipeline(db, tenant(c)) }));

  router.get('/content', async (c) => {
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
  });

  router.post('/content', async (c) => {
    const body = await parseBody(c, ContentItemBody);
    return Response.json(await createContentItem(db, c.env as Env, tenant(c), await who(c), {
      title: String(body.title ?? ''),
      format: String(body.format ?? ''),
      channel: body.channel ?? null,
      brief: body.brief ?? null,
      ownerRef: body.ownerRef ?? (c.get('userId') as string | undefined) ?? null,
      artifactId: body.artifactId ?? null,
    }), { status: 201 });
  });

  // ── Emails and nurture ────────────────────────────────────────────────────

  router.get('/emails', async (c) =>
    Response.json({ emails: await listEmails(db, tenant(c)) }));

  router.put('/emails/:key', manager, async (c) => {
    const body = await parseBody(c, EmailBody);
    return Response.json(await upsertEmail(db, tenant(c), {
      key: c.req.param('key'),
      name: String(body.name ?? ''),
      subject: body.subject ?? null,
      bodyHtml: body.bodyHtml ?? null,
      bodyText: body.bodyText ?? null,
      variables: body.variables,
      ...(body.isTemplate != null ? { isTemplate: body.isTemplate } : {}),
    }));
  });

  router.get('/emails/:key', async (c) => {
    const email = await emailByKey(db, tenant(c), c.req.param('key'));
    if (!email) return Response.json({ error: 'No template with that key.' }, { status: 404 });
    return Response.json(email);
  });

  router.get('/nurture', async (c) =>
    Response.json({ flows: await listNurtureFlows(db, tenant(c), c.req.query('status') as FlowStatus | undefined) }));

  router.put('/nurture', manager, async (c) => {
    const body = await parseBody(c, NurtureFlowBody);
    return Response.json(await saveNurtureFlow(db, tenant(c), {
      ...(body.id != null ? { id: body.id } : {}),
      name: String(body.name ?? ''),
      goal: body.goal ?? null,
      steps: body.steps ?? [],
      entryRule: body.entryRule,
      exitRule: body.exitRule,
      ...(body.status != null ? { status: body.status as FlowStatus } : {}),
      ownerRef: body.ownerRef ?? null,
    }));
  });

  // ── Learn videos and podcasts ─────────────────────────────────────────────

  router.get('/learn/:surface', async (c) =>
    Response.json({ videos: await videosForSurface(db, tenant(c), c.req.param('surface')) }));

  router.post('/learn', manager, async (c) => {
    const body = await parseBody(c, LearnVideoBody);
    const videoId = body.videoId;
    if (videoId == null) throw new ContentError('videoId is required', 400);
    return Response.json(await attachLearnVideo(db, tenant(c), {
      videoId,
      surface: String(body.surface ?? ''),
      title: String(body.title ?? ''),
      featureKey: body.featureKey ?? null,
      ...(body.position != null ? { position: body.position } : {}),
    }), { status: 201 });
  });

  router.get('/podcasts/pipeline', async (c) =>
    Response.json({ pipeline: await outreachPipeline(db, tenant(c)) }));

  router.post('/podcasts', async (c) => {
    const body = await parseBody(c, OutreachBody);
    return Response.json(await recordOutreach(db, tenant(c), {
      showName: String(body.showName ?? ''),
      hostName: body.hostName ?? null,
      contactEmail: body.contactEmail ?? null,
      audienceSize: body.audienceSize ?? null,
      topicPitch: body.topicPitch ?? null,
    }), { status: 201 });
  });

  router.patch('/podcasts/:id', async (c) => {
    const body = await parseBody(c, StatusBody);
    return Response.json(await advanceOutreach(
      db, c.env as Env, tenant(c), await who(c),
      rowId(c.req.param('id')), String(body.status ?? '') as OutreachStatus,
    ));
  });

  // ── Heatmaps and embeds ───────────────────────────────────────────────────

  router.get('/heatmaps/readable', async (c) =>
    Response.json({ pages: await readablePages(db, tenant(c)) }));

  router.get('/heatmaps', async (c) => {
    const path = c.req.query('path');
    if (!path) throw new PageInsightError('path is required', 400);
    return Response.json({
      current: await heatmapFor(db, tenant(c), path),
      history: await heatmapHistory(db, tenant(c), path),
    });
  });

  router.post('/heatmaps', manager, async (c) => {
    const body = await parseBody(c, HeatmapBody);
    const periodStart = whenOrUndefined(body.periodStart);
    const periodEnd = whenOrUndefined(body.periodEnd);
    if (!periodStart || !periodEnd) throw new PageInsightError('periodStart and periodEnd are required', 400);
    return Response.json(await storeHeatmap(db, tenant(c), {
      path: String(body.path ?? ''),
      clickMap: body.clickMap,
      scrollMap: body.scrollMap,
      sampleCount: body.sampleCount ?? 0,
      periodStart,
      periodEnd,
    }), { status: 201 });
  });

  router.post('/heatmaps/:id/screenshots', manager, async (c) => {
    const body = await parseBody(c, ScreenshotBody);
    return Response.json(await addScreenshot(db, tenant(c), rowId(c.req.param('id')), {
      artifactId: body.artifactId ?? null,
      viewportWidth: body.viewportWidth ?? 0,
      viewportHeight: body.viewportHeight ?? null,
      ...(body.themeMode === 'dark' ? { themeMode: 'dark' as const } : {}),
    }), { status: 201 });
  });

  router.get('/heatmaps/:id/screenshot', async (c) => {
    const width = Number(c.req.query('viewportWidth') ?? 0);
    if (!Number.isFinite(width) || width <= 0) throw new PageInsightError('viewportWidth is required', 400);
    return Response.json({
      screenshot: await screenshotFor(
        db, tenant(c), rowId(c.req.param('id')), width,
        c.req.query('themeMode') === 'dark' ? 'dark' : 'light',
      ),
    });
  });

  router.get('/embeds', async (c) =>
    Response.json({ layouts: await listEmbedLayouts(db, tenant(c)) }));

  router.put('/embeds/:widgetKey', manager, async (c) => {
    const body = await parseBody(c, EmbedLayoutBody);
    return Response.json(await setEmbedLayout(db, tenant(c), {
      widgetKey: c.req.param('widgetKey'),
      hostPattern: body.hostPattern ?? null,
      ...(body.mode != null ? { mode: body.mode as EmbedMode } : {}),
      config: body.config,
    }));
  });

  router.get('/embeds/:widgetKey', async (c) =>
    Response.json({ layout: await layoutFor(db, tenant(c), c.req.param('widgetKey'), c.req.query('host')) }));

  // ── Waitlist ──────────────────────────────────────────────────────────────

  router.get('/waitlist/overview', async (c) =>
    Response.json(await waitlistOverview(db, tenant(c))));

  router.get('/waitlist/regions', async (c) =>
    Response.json({ regions: await regionDemand(db, tenant(c)) }));

  router.get('/waitlist/funnel', async (c) =>
    Response.json(await conversionFunnel(db, tenant(c), c.req.query('listKey'))));

  router.post('/waitlist/join', async (c) => {
    const body = await parseBody(c, JoinListBody);
    return Response.json(await joinList(db, tenant(c), {
      listKey: String(body.listKey ?? ''),
      email: String(body.email ?? ''),
      name: body.name ?? null,
      referrer: body.referrer ?? null,
    }), { status: 201 });
  });

  /** A country the vocabulary knows, normalised to its ISO code — or a 400 that
   *  names the code, so a region list never fills with "usa", "US " and "United States". */
  const knownCountry = async (c: { env: unknown }, raw: string | null): Promise<string | null> => {
    if (!raw) return null;
    const match = await country(db, c.env as Env, raw);
    if (!match) throw new WaitlistError(`Unknown country code: ${raw}`, 400);
    return match.code;
  };

  router.post('/waitlist/regions/join', async (c) => {
    const body = await parseBody(c, JoinRegionBody);
    return Response.json(await joinRegion(db, tenant(c), {
      email: String(body.email ?? ''),
      country: await knownCountry(c, body.country ?? null),
      region: body.region ?? null,
      source: body.source ?? null,
    }), { status: 201 });
  });

  router.post('/waitlist/invite', manager, async (c) => {
    const body = await parseBody(c, InviteBody);
    const emails = (body.emails ?? []).map((e) => String(e));
    return Response.json(await inviteFromList(
      db, c.env as Env, tenant(c), await who(c), String(body.listKey ?? ''), emails,
    ));
  });

  router.post('/waitlist/regions/:country/open', manager, async (c) =>
    Response.json(await inviteRegion(
      db, c.env as Env, tenant(c), await who(c), (await knownCountry(c, c.req.param('country'))) ?? '',
    )));

  router.post('/waitlist/outcome', async (c) => {
    const body = await parseBody(c, OutcomeBody);
    const outcome = body.outcome;
    if (outcome !== 'joined' && outcome !== 'declined') {
      throw new WaitlistError("outcome must be 'joined' or 'declined'", 400);
    }
    return Response.json(await markOutcome(db, tenant(c), String(body.email ?? ''), outcome));
  });

  router.get('/waitlist/:listKey', async (c) =>
    Response.json({
      entries: await listEntries(
        db, tenant(c), c.req.param('listKey'), c.req.query('status') as WaitlistStatus | undefined,
      ),
    }));

  // ── Onboarding ────────────────────────────────────────────────────────────

  router.get('/onboarding/flows', async (c) =>
    Response.json({
      flows: await flowsForAudience(db, tenant(c), (c.req.query('audience') ?? 'signup') as Audience),
    }));

  router.post('/onboarding/flows', manager, async (c) => {
    const body = await parseBody(c, FlowBody);
    return Response.json(await createFlow(db, tenant(c), {
      key: String(body.key ?? ''),
      name: String(body.name ?? ''),
      ...(body.audience != null ? { audience: body.audience as Audience } : {}),
      description: body.description ?? null,
    }), { status: 201 });
  });

  router.get('/onboarding/flows/:id', async (c) =>
    Response.json(await flowDefinition(db, tenant(c), rowId(c.req.param('id')))));

  router.post('/onboarding/flows/:id/checklists', manager, async (c) => {
    const body = await parseBody(c, ChecklistBody);
    return Response.json(await addChecklist(db, tenant(c), rowId(c.req.param('id')), {
      name: String(body.name ?? ''),
      summary: body.summary ?? null,
      ...(body.isRequired != null ? { isRequired: body.isRequired } : {}),
    }), { status: 201 });
  });

  router.post('/onboarding/checklists/:id/tasks', manager, async (c) => {
    const body = await parseBody(c, TaskBody);
    return Response.json(await addTask(db, tenant(c), rowId(c.req.param('id')), {
      key: String(body.key ?? ''),
      title: String(body.title ?? ''),
      description: body.description ?? null,
      actionHref: body.actionHref ?? null,
      ...(body.completionKind === 'event' || body.completionKind === 'query'
        ? { completionKind: body.completionKind }
        : {}),
      completionRule: body.completionRule,
      ...(body.isRequired != null ? { isRequired: body.isRequired } : {}),
    }), { status: 201 });
  });

  router.get('/onboarding/flows/:id/funnel', manager, async (c) =>
    Response.json({ steps: await flowFunnel(db, tenant(c), rowId(c.req.param('id'))) }));

  router.get('/onboarding/flows/:id/progress', async (c) =>
    Response.json(await flowProgress(
      db, tenant(c), rowId(c.req.param('id')),
      c.req.query('subjectRef') ?? String(c.get('userId') ?? ''),
    )));

  router.put('/onboarding/progress', async (c) => {
    const body = await parseBody(c, ProgressBody);
    const flowId = body.flowId;
    const taskId = body.taskId;
    if (flowId == null || taskId == null) {
      throw new OnboardingError('flowId and taskId are required', 400);
    }
    return Response.json(await setProgress(db, tenant(c), {
      flowId,
      taskId,
      subjectRef: body.subjectRef ?? String(c.get('userId') ?? ''),
      status: String(body.status ?? '') as ProgressStatus,
      skippedReason: body.skippedReason ?? null,
    }));
  });

  router.post('/onboarding/flows/:id/skip', async (c) => {
    const body = await parseOptionalBody(c, SkipFlowBody);
    return Response.json(await completeFlow(
      db, c.env as Env, tenant(c), await who(c), rowId(c.req.param('id')),
      body.subjectRef ?? String(c.get('userId') ?? ''),
      body.reason ?? 'skipped by the user',
    ));
  });

  return router;
}
