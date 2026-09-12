/**
 * Request-body schemas for `practiceOpsRoutes.ts` — split out so the route module
 * does not grow by its own contract.
 *
 * Every handler used to read `Record<string, unknown>` and type-guard each field
 * (`str(x)`, `num(x)`, `typeof x === 'boolean'`, `String(x ?? '')`). These schemas
 * state those same guards as the shape, so a `name: {}` or a `cards: "x"` is a 400
 * with a field path instead of a silently-dropped field or a TypeError on a `null`
 * body answered as a 500. The conventions:
 *
 *   - a field the handler `String()`s is `zNumberLike` — a string, or a number the
 *     coercion always accepted;
 *   - every optional field is `.nullish()`, because the handler read `null` as absent;
 *   - a date is a string: the handler's `when()` still parses it and still answers
 *     "That is not a date." for one it cannot read;
 *   - an opaque JSON column (`theme`, `placement`, `arguments`, …) is `z.unknown()`,
 *     stored as the caller sent it;
 *   - a vocabulary field (`mode`, `status`, `visibility`, `kind`, `outcome`) is a
 *     plain string: the service refuses a wrong value with its own
 *     "X must be one of: …" sentence, which stays the answer.
 *
 * A required field the handler answers its own "X is required" sentence for stays
 * OPTIONAL here so that sentence still wins.
 */
import { z, zNumberLike } from './requestBody';

// ── Shared ───────────────────────────────────────────────────────────────────

/**
 * `PATCH /booking/reservations/:id`, `PATCH /agency/clients/:id`,
 * `PATCH /support/articles/:id/status` — the service owns the status vocabulary.
 */
export const StatusBody = z.object({ status: zNumberLike.nullish() });

// ── Booking ──────────────────────────────────────────────────────────────────

/** `POST /booking/services`. */
export const CreateServiceBody = z.object({
  slug: zNumberLike.nullish(),
  name: zNumberLike.nullish(),
  description: z.string().nullish(),
  durationMin: z.number().nullish(),
  bufferMin: z.number().nullish(),
  priceCents: z.number().nullish(),
  currency: z.string().nullish(),
  mode: z.string().nullish(),
  capacity: z.number().nullish(),
});

/** `POST /booking/services/:id/hosts`. */
export const AddHostBody = z.object({
  hostRef: zNumberLike.nullish(),
  timezone: z.string().nullish(),
  priority: z.number().nullish(),
  connectionId: z.number().nullish(),
});

/** `POST /booking/reservations` — the handler refuses a missing serviceId/startsAt itself. */
export const ReserveBody = z.object({
  serviceId: z.number().nullish(),
  startsAt: z.string().nullish(),
  hostRef: z.string().nullish(),
  bookerRef: z.string().nullish(),
  bookerEmail: z.string().nullish(),
  timezone: z.string().nullish(),
});

// ── Agency ───────────────────────────────────────────────────────────────────

/** `PUT /agency/:agencyRef/branding`. */
export const BrandingBody = z.object({
  name: zNumberLike.nullish(),
  logoArtifactId: z.string().nullish(),
  theme: z.unknown().optional(),
  tagline: z.string().nullish(),
  website: z.string().nullish(),
});

/** `POST /agency/:agencyRef/clients`. */
export const AddClientBody = z.object({
  clientName: zNumberLike.nullish(),
  companyRef: z.string().nullish(),
  retainerCents: z.number().nullish(),
  currency: z.string().nullish(),
  startedAt: z.string().nullish(),
});

// ── Consulting ───────────────────────────────────────────────────────────────

/** `PUT /consulting/decks`. */
export const SaveDeckBody = z.object({
  id: z.number().nullish(),
  slug: zNumberLike.nullish(),
  name: zNumberLike.nullish(),
  description: z.string().nullish(),
  cards: z.array(z.unknown()).nullish(),
  priceCents: z.number().nullish(),
  currency: z.string().nullish(),
  visibility: z.string().nullish(),
});

/** `POST /consulting/:consultantRef/knowledge`. */
export const KnowledgeDocBody = z.object({
  title: zNumberLike.nullish(),
  summary: z.string().nullish(),
  artifactId: z.string().nullish(),
});

/** `POST /consulting/consultations`. */
export const ConsultationBody = z.object({
  consultantRef: zNumberLike.nullish(),
  clientRef: z.string().nullish(),
  reservationId: z.number().nullish(),
  topic: z.string().nullish(),
  durationMin: z.number().nullish(),
  rateCents: z.number().nullish(),
  currency: z.string().nullish(),
});

/** `PATCH /consulting/consultations/:id`. */
export const ConsultationStatusBody = z.object({
  status: zNumberLike.nullish(),
  recordingArtifactId: z.string().nullish(),
});

// ── AI operations ────────────────────────────────────────────────────────────

/** `POST /ai/tools`. */
export const ToolCallBody = z.object({
  toolName: zNumberLike.nullish(),
  outcome: z.string().nullish(),
  runRef: z.string().nullish(),
  messageRef: z.string().nullish(),
  arguments: z.unknown().optional(),
  result: z.unknown().optional(),
});

/** `POST /ai/classifications`. */
export const ClassificationBody = z.object({
  messageRef: zNumberLike.nullish(),
  label: zNumberLike.nullish(),
  confidence: z.number().nullish(),
  intent: z.string().nullish(),
  entities: z.unknown().optional(),
  model: zNumberLike.nullish(),
});

/** `PUT /ai/competitors`. */
export const CompetitorBody = z.object({
  id: z.number().nullish(),
  name: zNumberLike.nullish(),
  website: z.string().nullish(),
  category: z.string().nullish(),
  positioning: z.string().nullish(),
  strengths: z.unknown().optional(),
  weaknesses: z.unknown().optional(),
});

// ── People ───────────────────────────────────────────────────────────────────

/** `PUT /people/dimensions`. */
export const DimensionBody = z.object({
  key: zNumberLike.nullish(),
  label: zNumberLike.nullish(),
  description: z.string().nullish(),
  weight: z.number().nullish(),
  benchmark: z.number().nullish(),
  position: z.number().nullish(),
});

/** `POST /people/health-score` — a score per dimension key; unscored keys are simply absent. */
export const HealthScoreBody = z.object({
  scores: z.record(z.string(), z.number()).nullish(),
});

/** `POST /people/employees/:id/emergency-contacts`. */
export const EmergencyContactBody = z.object({
  name: zNumberLike.nullish(),
  relationship: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().nullish(),
  isPrimary: z.boolean().nullish(),
});

/** `POST /people/cohorts` — the handler refuses a missing cohortStartedAt itself. */
export const CohortBody = z.object({
  cohortKey: zNumberLike.nullish(),
  cohortStartedAt: z.string().nullish(),
  periodDays: z.number().nullish(),
  startingCount: z.number().nullish(),
  retainedCount: z.number().nullish(),
});

// ── Portfolio ────────────────────────────────────────────────────────────────

/** `PUT /portfolio/modules`. */
export const ModuleBody = z.object({
  key: zNumberLike.nullish(),
  name: zNumberLike.nullish(),
  description: z.string().nullish(),
  domain: z.string().nullish(),
  requiredRung: z.number().nullish(),
  position: z.number().nullish(),
});

/** `POST /portfolio/companies/:id/comparables`. */
export const ComparableBody = z.object({
  peerName: zNumberLike.nullish(),
  sector: z.string().nullish(),
  revenue: z.number().nullish(),
  growthRate: z.number().nullish(),
  multiple: z.number().nullish(),
});

/** `POST /portfolio/pads/:padObjectId`. */
export const PadAttachmentBody = z.object({
  artifactId: z.string().nullish(),
  label: z.string().nullish(),
  placement: z.unknown().optional(),
});

/**
 * `PATCH /portfolio/attachments/:id` — a patch: an absent key is left alone, a
 * `null` label clears it.
 */
export const AttachmentPatchBody = z.object({
  label: z.string().nullish(),
  placement: z.unknown().optional(),
});

// ── Customer surface ─────────────────────────────────────────────────────────

/** `POST /support/articles`. */
export const ArticleBody = z.object({
  slug: zNumberLike.nullish(),
  title: zNumberLike.nullish(),
  summary: z.string().nullish(),
  body: z.string().nullish(),
  kind: z.string().nullish(),
  category: z.string().nullish(),
  tags: z.unknown().optional(),
  visibility: z.string().nullish(),
  ownerRef: z.string().nullish(),
});

/** `PATCH /support/articles/:id/visibility` — the service owns the vocabulary. */
export const ArticleVisibilityBody = z.object({ visibility: zNumberLike.nullish() });

/** `PUT /support/widgets/:key`. */
export const WidgetBody = z.object({
  name: zNumberLike.nullish(),
  kind: z.string().nullish(),
  questionSetId: z.string().nullish(),
  placement: z.unknown().optional(),
  audience: z.unknown().optional(),
  theme: z.unknown().optional(),
  cooldownDays: z.number().nullish(),
  enabled: z.boolean().nullish(),
});

/** `PUT /support/monitors`. */
export const MonitorBody = z.object({
  id: z.number().nullish(),
  name: zNumberLike.nullish(),
  kind: z.string().nullish(),
  target: zNumberLike.nullish(),
  method: z.string().nullish(),
  expectStatus: z.number().nullish(),
  expectBody: z.string().nullish(),
  intervalSec: z.number().nullish(),
  timeoutMs: z.number().nullish(),
  failThreshold: z.number().nullish(),
  regions: z.unknown().optional(),
  enabled: z.boolean().nullish(),
});

/** `POST /support/monitors/:id/probe` — the handler answers "ok must be true or false" itself. */
export const ProbeBody = z.object({
  ok: z.unknown().optional(),
  consecutiveFailures: z.number().nullish(),
});
