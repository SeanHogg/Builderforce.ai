/**
 * Feedback spec — the pure, DB-free half of the Product Feedback pillar.
 *
 * Holds the canonical submission shape, the `tasks.source` markers that make an
 * external request non-executable, the normalizer every inbound channel funnels
 * through (public snippet, in-app panel), and the ticket draft renderer.
 *
 * The two source markers are the whole human gate, so they live HERE (one import
 * for the ingest engine, the auto-run evaluator and the triage routes) rather
 * than as string literals scattered across layers:
 *
 *   FEEDBACK_TASK_SOURCE          — an unapproved external request. evaluateTaskAutoRun
 *                                   short-circuits on it BEFORE resolving a board, lane
 *                                   or agent, so no dispatch path can start a run.
 *   FEEDBACK_APPROVED_TASK_SOURCE — a human accepted the request in triage. The ticket
 *                                   now behaves like ordinary work while keeping its
 *                                   provenance (it is still visibly external).
 */

/** An external request awaiting human approval — hard-gated from all execution. */
export const FEEDBACK_TASK_SOURCE = 'feedback';
/** A human approved the request; the ticket is executable and keeps its origin. */
export const FEEDBACK_APPROVED_TASK_SOURCE = 'feedback_approved';

/** Is this ticket an external feedback request still awaiting human approval? */
export function isUnapprovedFeedbackTask(source: string | null | undefined): boolean {
  return source === FEEDBACK_TASK_SOURCE;
}

export const FEEDBACK_KINDS = ['feature', 'bug', 'idea', 'other'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_STATUSES = ['new', 'approved', 'declined'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const TITLE_MAX = 300;
export const BODY_MAX = 10_000;

/** A validated, size-bounded feedback request ready for the engine. */
export interface NormalizedFeedback {
  kind: FeedbackKind;
  title: string;
  body: string;
  submitterEmail: string | null;
  submitterName: string | null;
  pageUrl: string | null;
  userAgent: string | null;
  appVersion: string | null;
  context: Record<string, unknown> | null;
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Coerce an arbitrary public payload into a bounded submission, or explain why
 * it is unusable. Every field is length-capped here so an unauthenticated POST
 * can never write an oversized row. A missing title is derived from the body's
 * first line, so a widget with a single textarea is a valid client.
 */
export function normalizeFeedback(raw: unknown): { ok: true; value: NormalizedFeedback } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Body must be an object' };
  const o = raw as Record<string, unknown>;

  const body = str(o.body ?? o.message ?? o.description, BODY_MAX);
  if (!body) return { ok: false, error: 'body is required' };

  const rawKind = typeof o.kind === 'string' ? o.kind.trim().toLowerCase() : '';
  const kind: FeedbackKind = (FEEDBACK_KINDS as readonly string[]).includes(rawKind)
    ? (rawKind as FeedbackKind)
    : 'feature';

  // No explicit title → the body's first line (the single-textarea widget case).
  const title = str(o.title ?? o.subject, TITLE_MAX) ?? body.split('\n')[0]!.slice(0, TITLE_MAX);

  const ctx = o.context && typeof o.context === 'object' && !Array.isArray(o.context)
    ? (o.context as Record<string, unknown>)
    : null;

  return {
    ok: true,
    value: {
      kind,
      title,
      body,
      submitterEmail: str(o.email ?? o.submitterEmail, 255),
      submitterName: str(o.name ?? o.submitterName, 255),
      pageUrl: str(o.url ?? o.pageUrl, 2000),
      userAgent: str(o.userAgent, 1000),
      appVersion: str(o.appVersion ?? o.release, 64),
      context: ctx,
    },
  };
}

/** SHA-256 hex of a string (WebCrypto — available in the Workers runtime). */
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Duplicate-collapse key: the same request re-submitted (a double-click, a user
 * re-reporting the identical wording) maps to one submission and one ticket.
 * Whitespace/case-insensitive so trivially-different retypings still collapse.
 */
export function computeFeedbackFingerprint(f: Pick<NormalizedFeedback, 'kind' | 'title' | 'body'>): Promise<string> {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return sha256Hex(`${f.kind}|${norm(f.title)}|${norm(f.body)}`);
}

/** Board-facing labels for a request kind (the ticket title prefix). */
const KIND_LABEL: Record<FeedbackKind, string> = {
  feature: 'Feature request',
  bug: 'Bug report',
  idea: 'Idea',
  other: 'Feedback',
};

/**
 * Render a submission into the backlog ticket. The description leads with the
 * approval gate so anyone opening the card knows it is an external request that
 * will not move until a human accepts it.
 */
export function buildFeedbackTaskDraft(
  f: NormalizedFeedback,
  meta: { submitterLabel: string | null },
): { title: string; description: string } {
  const who = meta.submitterLabel ? ` by ${meta.submitterLabel}` : '';
  const description =
    `**External request** submitted${who} through the product feedback collector.\n\n` +
    `This ticket is awaiting human approval and will NOT be picked up by an agent until someone accepts it in the feedback triage queue.\n\n` +
    `**Type:** ${KIND_LABEL[f.kind]}\n` +
    (f.pageUrl ? `**Submitted from:** ${f.pageUrl}\n` : '') +
    (f.appVersion ? `**App version:** ${f.appVersion}\n` : '') +
    (f.submitterEmail ? `**Contact:** ${f.submitterEmail}\n` : '') +
    `\n---\n\n${f.body}\n`;
  return { title: `[${KIND_LABEL[f.kind]}] ${f.title.slice(0, 240)}`, description };
}
