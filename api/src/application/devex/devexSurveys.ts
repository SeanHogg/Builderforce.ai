/**
 * DevEx Surveys (ROADMAP EMP-15) — domain types + Drizzle table definitions for
 * the developer-experience pulse-survey framework.
 *
 * A *template* is a named set of questions. A *campaign* sends a template to the
 * workspace for a period (open → closed). A *response* is one submission per
 * respondent per campaign, with answers keyed by question id.
 *
 * The pgTable definitions live here (not only in schema.ts) so the routes + the
 * insights collector share one source of truth and the migration (0229) is the
 * DDL contract. The same definitions are mirrored into schema.ts by the
 * orchestrator merge so the rest of the app's typed `schema` import sees them.
 */

import { pgTable, serial, integer, uuid, varchar, text, jsonb, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { tenants, segments } from '../../infrastructure/database/schema';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** A question's answer type. rating=1..5, nps=0..10, boolean, free text. */
export type QuestionType = 'rating' | 'nps' | 'boolean' | 'text';

/**
 * Dimension a question feeds. Drives the per-dimension rollup in the insights
 * lens; `ai_tools` is the focused "AI DevEx Analysis" cut.
 */
export type DevexDimension =
  | 'flow' | 'tooling' | 'ai_tools' | 'deep_work' | 'build_test' | 'docs' | 'sentiment';

export const DEVEX_DIMENSIONS: readonly DevexDimension[] = [
  'flow', 'tooling', 'ai_tools', 'deep_work', 'build_test', 'docs', 'sentiment',
] as const;

/**
 * The demographic axes a response can be tagged on, so results break down by
 * segment (the heatmap / participation-by-segment visuals). Captured per response
 * — NOT joined to the user — so anonymous surveys stay anonymous; the rollup hides
 * any segment group with fewer than {@link ANONYMITY_THRESHOLD} responses.
 */
export type DevexSegmentKind = 'group' | 'team' | 'location' | 'role';

export const DEVEX_SEGMENT_KINDS: readonly DevexSegmentKind[] = ['group', 'team', 'location', 'role'] as const;

/** A response's optional segment tags (kind → label). */
export type DevexSegments = Partial<Record<DevexSegmentKind, string>>;

/** Never show detailed segment results for groups smaller than this. */
export const ANONYMITY_THRESHOLD = 3;

const QUESTION_TYPES: readonly QuestionType[] = ['rating', 'nps', 'boolean', 'text'] as const;

export interface SurveyQuestion {
  /** Stable id used as the key in a response's `answers` map. */
  id: string;
  type: QuestionType;
  prompt: string;
  dimension: DevexDimension;
}

export interface SurveyTemplate {
  id: number;
  tenantId: number;
  segmentId: string | null;
  name: string;
  description: string;
  questions: SurveyQuestion[];
  isActive: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Campaign {
  id: number;
  tenantId: number;
  segmentId: string | null;
  templateId: number | null;
  title: string;
  periodMonth: string | null;
  status: 'open' | 'closed';
  anonymous: boolean;
  /** Expected reach — drives an honest response rate (responses ÷ recipients). */
  recipientCount: number | null;
  openedAt: Date;
  closedAt: Date | null;
  createdAt: Date;
}

/** A response's answers: question id → scalar answer (number | boolean | string). */
export type AnswerValue = number | boolean | string;
export type AnswerMap = Record<string, AnswerValue>;

export interface Response {
  id: number;
  tenantId: number;
  campaignId: number;
  respondentHash: string | null;
  userId: string | null;
  answers: AnswerMap;
  segments: DevexSegments;
  submittedAt: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True when `q` is a structurally-valid survey question. */
export function isValidQuestion(q: unknown): q is SurveyQuestion {
  if (!q || typeof q !== 'object') return false;
  const r = q as Record<string, unknown>;
  return (
    typeof r.id === 'string' && r.id.length > 0 &&
    typeof r.prompt === 'string' &&
    QUESTION_TYPES.includes(r.type as QuestionType) &&
    DEVEX_DIMENSIONS.includes(r.dimension as DevexDimension)
  );
}

/** Coerce/validate a question list (drops malformed entries). */
export function normalizeQuestions(input: unknown): SurveyQuestion[] {
  if (!Array.isArray(input)) return [];
  return input.filter(isValidQuestion);
}

/**
 * Coerce a submitted segment map to the known kinds with trimmed, length-capped
 * string labels. Unknown keys and empty/blank labels are dropped, so a malformed
 * or missing body simply yields `{}` (an untagged response).
 */
export function normalizeSegments(input: unknown): DevexSegments {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: DevexSegments = {};
  for (const kind of DEVEX_SEGMENT_KINDS) {
    const raw = (input as Record<string, unknown>)[kind];
    if (typeof raw !== 'string') continue;
    const label = raw.trim().slice(0, 80);
    if (label) out[kind] = label;
  }
  return out;
}

/**
 * Validate a submitted answer map against a template's questions. Returns a
 * cleaned answer map (only known questions, coerced to the question's type) and
 * a list of human-readable errors for answers that are out of range / wrong type.
 * Unanswered questions are allowed (a pulse survey is opt-in per question);
 * answers for unknown question ids are dropped.
 */
export function validateAnswers(
  questions: SurveyQuestion[],
  answers: unknown,
): { clean: AnswerMap; errors: string[] } {
  const errors: string[] = [];
  const clean: AnswerMap = {};
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return { clean, errors: ['answers must be an object keyed by question id'] };
  }
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const [qid, raw] of Object.entries(answers as Record<string, unknown>)) {
    const q = byId.get(qid);
    if (!q) continue; // drop answers to unknown questions
    if (raw == null || raw === '') continue; // unanswered — skip silently

    switch (q.type) {
      case 'rating': {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 1 || n > 5) { errors.push(`${qid}: rating must be 1..5`); break; }
        clean[qid] = Math.round(n);
        break;
      }
      case 'nps': {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0 || n > 10) { errors.push(`${qid}: nps must be 0..10`); break; }
        clean[qid] = Math.round(n);
        break;
      }
      case 'boolean': {
        if (typeof raw === 'boolean') { clean[qid] = raw; break; }
        if (raw === 'true' || raw === 'false') { clean[qid] = raw === 'true'; break; }
        errors.push(`${qid}: boolean must be true/false`);
        break;
      }
      case 'text': {
        clean[qid] = String(raw).slice(0, 2000);
        break;
      }
    }
  }
  return { clean, errors };
}

/**
 * Stable, non-reversible hash of (userId, campaignId) → a 64-char hex-ish token.
 * Used as `respondent_hash` for anonymous campaigns so we can dedup one
 * submission per respondent WITHOUT storing who they are. A simple FNV-1a-style
 * rolling hash, expanded to 64 chars — sync, dependency-free, deterministic.
 */
export function respondentHash(userId: string, campaignId: number): string {
  const input = `${userId}:${campaignId}`;
  // Two independent 32-bit hashes with different seeds, concatenated and tiled
  // to fill 64 hex chars so collisions across distinct (user,campaign) are rare.
  const h1 = fnv1a(input, 0x811c9dc5);
  const h2 = fnv1a(input, 0x01000193);
  const h3 = fnv1a(`${input}:b`, 0x811c9dc5);
  const h4 = fnv1a(`${input}:b`, 0x01000193);
  return [h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('').slice(0, 64);
}

function fnv1a(str: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Drizzle tables (mirror migration 0229 exactly)
// ---------------------------------------------------------------------------

export const devexSurveyTemplates = pgTable('devex_survey_templates', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  name:        varchar('name', { length: 160 }).notNull(),
  description: text('description').notNull().default(''),
  questions:   jsonb('questions').$type<SurveyQuestion[]>().notNull().default([]),
  isActive:    boolean('is_active').notNull().default(true),
  createdBy:   varchar('created_by', { length: 36 }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_devex_templates_tenant').on(t.tenantId),
]);

export const devexCampaigns = pgTable('devex_campaigns', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  templateId:  integer('template_id').references(() => devexSurveyTemplates.id, { onDelete: 'set null' }),
  title:       varchar('title', { length: 200 }).notNull(),
  periodMonth: varchar('period_month', { length: 7 }),
  status:      varchar('status', { length: 16 }).notNull().default('open').$type<'open' | 'closed'>(),
  anonymous:   boolean('anonymous').notNull().default(true),
  recipientCount: integer('recipient_count'),
  openedAt:    timestamp('opened_at').notNull().defaultNow(),
  closedAt:    timestamp('closed_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_devex_campaigns_tenant').on(t.tenantId),
]);

export const devexResponses = pgTable('devex_responses', {
  id:             serial('id').primaryKey(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  campaignId:     integer('campaign_id').notNull().references(() => devexCampaigns.id, { onDelete: 'cascade' }),
  respondentHash: varchar('respondent_hash', { length: 64 }),
  userId:         varchar('user_id', { length: 36 }),
  answers:        jsonb('answers').$type<AnswerMap>().notNull().default({}),
  segments:       jsonb('segments').$type<DevexSegments>().notNull().default({}),
  submittedAt:    timestamp('submitted_at').notNull().defaultNow(),
}, (t) => [
  index('idx_devex_responses_tenant').on(t.tenantId),
  index('idx_devex_responses_campaign').on(t.campaignId),
  index('idx_devex_responses_dedup').on(t.campaignId, t.respondentHash),
]);
