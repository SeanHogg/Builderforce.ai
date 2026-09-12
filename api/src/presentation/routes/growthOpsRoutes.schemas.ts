/**
 * Request-body schemas for `growthOpsRoutes.ts` — split out so the route module
 * does not grow by its own contract.
 *
 * Every handler used to read `Record<string, unknown>` and type-guard each field
 * (`str(x)`, `num(x)`, `typeof x === 'boolean'`, `String(x ?? '')`). These schemas
 * state those same guards as the shape, so a `variants: [null]` or a `rule: "x"` is
 * a 400 with a field path instead of a TypeError answered as a 500. The conventions:
 *
 *   - a field the handler `String()`s is `zNumberLike` — a string, or a number the
 *     coercion always accepted;
 *   - every optional field is `.nullish()`, because the handler read `null` as absent;
 *   - a date is a string: the handler's `when()` still parses it and still answers
 *     "That is not a date." for one it cannot read;
 *   - an opaque JSON column (`palette`, `config`, `payload`, …) is `z.unknown()`,
 *     stored as the caller sent it;
 *   - a vocabulary field (`status`, `mode`, `audience`) is a plain string: the
 *     service refuses a wrong value with its own "X must be one of: …" sentence,
 *     which stays the answer.
 *
 * A required field the handler answers its own "X is required" sentence for stays
 * OPTIONAL here so that sentence still wins.
 */
import { z, zJsonObject, zNumberLike } from './requestBody';

// ── Shared ───────────────────────────────────────────────────────────────────

/** `PATCH /podcasts/:id` — the service owns the outreach status vocabulary. */
export const StatusBody = z.object({ status: zNumberLike.nullish() });

// ── A/B tests ────────────────────────────────────────────────────────────────

/** `POST /tests`. */
export const CreateTestBody = z.object({
  key: zNumberLike.nullish(),
  name: zNumberLike.nullish(),
  hypothesis: z.string().nullish(),
  primaryMetric: z.string().nullish(),
  minimumSample: z.number().nullish(),
});

/** `PUT /tests/:id/variants` — the service refuses fewer than two itself. */
export const VariantsBody = z.object({
  variants: z.array(z.object({
    key: zNumberLike.nullish(),
    name: zNumberLike.nullish(),
    isControl: z.boolean().nullish(),
    trafficPercent: z.number().nullish(),
    payload: z.unknown().optional(),
  })).nullish(),
});

/** `POST /tests/:id/segments` — `rule` is stored as the JSON object it arrives as. */
export const SegmentBody = z.object({
  name: zNumberLike.nullish(),
  rule: zJsonObject.nullish(),
  isExclusion: z.boolean().nullish(),
});

/** `POST /tests/:id/stop` — the body is optional; only `concluded: true` concludes. */
export const StopTestBody = z.object({ concluded: z.boolean().nullish() });

// ── Journeys ─────────────────────────────────────────────────────────────────

/** `POST /journeys`. */
export const JourneyBody = z.object({
  name: zNumberLike.nullish(),
  persona: z.string().nullish(),
  stages: z.array(zNumberLike).nullish(),
  description: z.string().nullish(),
});

/** `POST /journeys/:id/touchpoints`. */
export const TouchpointBody = z.object({
  stage: zNumberLike.nullish(),
  subjectRef: z.string().nullish(),
  visitorId: z.string().nullish(),
  channel: z.string().nullish(),
  label: z.string().nullish(),
  attribution: z.number().nullish(),
  occurredAt: z.string().nullish(),
});

// ── Brand and content ────────────────────────────────────────────────────────

/** `POST /brand`. */
export const BrandKitBody = z.object({
  name: zNumberLike.nullish(),
  palette: z.unknown().optional(),
  typography: z.unknown().optional(),
  voice: z.string().nullish(),
  logoArtifactId: z.string().nullish(),
  logoDarkArtifactId: z.string().nullish(),
});

/** `POST /content`. */
export const ContentItemBody = z.object({
  title: zNumberLike.nullish(),
  format: zNumberLike.nullish(),
  channel: z.string().nullish(),
  brief: z.string().nullish(),
  ownerRef: z.string().nullish(),
  artifactId: z.string().nullish(),
});

// ── Emails and nurture ───────────────────────────────────────────────────────

/** `PUT /emails/:key`. */
export const EmailBody = z.object({
  name: zNumberLike.nullish(),
  subject: z.string().nullish(),
  bodyHtml: z.string().nullish(),
  bodyText: z.string().nullish(),
  variables: z.unknown().optional(),
  isTemplate: z.boolean().nullish(),
});

/** `PUT /nurture`. */
export const NurtureFlowBody = z.object({
  id: z.number().nullish(),
  name: zNumberLike.nullish(),
  goal: z.string().nullish(),
  steps: z.array(z.unknown()).nullish(),
  entryRule: z.unknown().optional(),
  exitRule: z.unknown().optional(),
  status: z.string().nullish(),
  ownerRef: z.string().nullish(),
});

// ── Learn videos and podcasts ────────────────────────────────────────────────

/** `POST /learn` — the handler refuses a missing videoId itself. */
export const LearnVideoBody = z.object({
  videoId: z.number().nullish(),
  surface: zNumberLike.nullish(),
  title: zNumberLike.nullish(),
  featureKey: z.string().nullish(),
  position: z.number().nullish(),
});

/** `POST /podcasts`. */
export const OutreachBody = z.object({
  showName: zNumberLike.nullish(),
  hostName: z.string().nullish(),
  contactEmail: z.string().nullish(),
  audienceSize: z.number().nullish(),
  topicPitch: z.string().nullish(),
});

// ── Heatmaps and embeds ──────────────────────────────────────────────────────

/** `POST /heatmaps` — the handler refuses a missing period itself. */
export const HeatmapBody = z.object({
  path: zNumberLike.nullish(),
  clickMap: z.unknown().optional(),
  scrollMap: z.unknown().optional(),
  sampleCount: z.number().nullish(),
  periodStart: z.string().nullish(),
  periodEnd: z.string().nullish(),
});

/** `POST /heatmaps/:id/screenshots` — any themeMode but `'dark'` reads as light. */
export const ScreenshotBody = z.object({
  artifactId: z.string().nullish(),
  viewportWidth: z.number().nullish(),
  viewportHeight: z.number().nullish(),
  themeMode: z.string().nullish(),
});

/** `PUT /embeds/:widgetKey`. */
export const EmbedLayoutBody = z.object({
  hostPattern: z.string().nullish(),
  mode: z.string().nullish(),
  config: z.unknown().optional(),
});

// ── Waitlist ─────────────────────────────────────────────────────────────────

/** `POST /waitlist/join`. */
export const JoinListBody = z.object({
  listKey: zNumberLike.nullish(),
  email: zNumberLike.nullish(),
  name: z.string().nullish(),
  referrer: z.string().nullish(),
});

/** `POST /waitlist/regions/join` — the handler normalises `country` against the vocabulary. */
export const JoinRegionBody = z.object({
  email: zNumberLike.nullish(),
  country: z.string().nullish(),
  region: z.string().nullish(),
  source: z.string().nullish(),
});

/** `POST /waitlist/invite`. */
export const InviteBody = z.object({
  listKey: zNumberLike.nullish(),
  emails: z.array(zNumberLike).nullish(),
});

/** `POST /waitlist/outcome` — the handler answers "outcome must be 'joined' or 'declined'" itself. */
export const OutcomeBody = z.object({
  email: zNumberLike.nullish(),
  outcome: z.unknown().optional(),
});

// ── Onboarding ───────────────────────────────────────────────────────────────

/** `POST /onboarding/flows`. */
export const FlowBody = z.object({
  key: zNumberLike.nullish(),
  name: zNumberLike.nullish(),
  audience: z.string().nullish(),
  description: z.string().nullish(),
});

/** `POST /onboarding/flows/:id/checklists`. */
export const ChecklistBody = z.object({
  name: zNumberLike.nullish(),
  summary: z.string().nullish(),
  isRequired: z.boolean().nullish(),
});

/** `POST /onboarding/checklists/:id/tasks` — an unknown completionKind reads as manual. */
export const TaskBody = z.object({
  key: zNumberLike.nullish(),
  title: zNumberLike.nullish(),
  description: z.string().nullish(),
  actionHref: z.string().nullish(),
  completionKind: z.string().nullish(),
  completionRule: z.unknown().optional(),
  isRequired: z.boolean().nullish(),
});

/** `PUT /onboarding/progress` — the handler refuses a missing flowId/taskId itself. */
export const ProgressBody = z.object({
  flowId: z.number().nullish(),
  taskId: z.number().nullish(),
  subjectRef: z.string().nullish(),
  status: zNumberLike.nullish(),
  skippedReason: z.string().nullish(),
});

/** `POST /onboarding/flows/:id/skip` — the body is optional. */
export const SkipFlowBody = z.object({
  subjectRef: z.string().nullish(),
  reason: z.string().nullish(),
});
