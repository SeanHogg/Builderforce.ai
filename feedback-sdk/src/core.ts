/**
 * Widget core — the DOM-free half, so payload building, endpoint resolution and
 * transport are unit-testable without a browser.
 */

import type { FeedbackKind, FeedbackLabels, FeedbackPayload, FeedbackWidgetOptions } from './types';

export const DEFAULT_ENDPOINT = 'https://api.builderforce.ai/api/feedback-ingest';

export const ALL_KINDS: FeedbackKind[] = ['feature', 'bug', 'idea', 'other'];

export const DEFAULT_LABELS: FeedbackLabels = {
  tab: 'Feedback',
  title: 'Send us feedback',
  intro: 'Tell us what would make this better. Feature requests, bugs, half-formed ideas — all welcome.',
  kindFeature: 'Feature request',
  kindBug: 'Bug report',
  kindIdea: 'Idea',
  kindOther: 'Something else',
  titleField: 'Summary',
  titlePlaceholder: 'One line — what do you want?',
  bodyField: 'Details',
  bodyPlaceholder: 'What are you trying to do, and what is getting in the way?',
  emailField: 'Your email (optional)',
  emailPlaceholder: 'you@company.com',
  submit: 'Send feedback',
  submitting: 'Sending…',
  close: 'Close',
  successTitle: 'Thank you',
  successBody: 'Your request has been filed for the team to review.',
  another: 'Send another',
  errorRequired: 'Please describe your feedback before sending.',
  errorGeneric: 'Something went wrong sending your feedback. Please try again.',
  errorRateLimited: 'We have received a lot of feedback today. Please try again tomorrow.',
};

/** Trim a trailing slash (and a mistakenly-included /submit) off the endpoint. */
export function normalizeEndpoint(endpoint: string | undefined): string {
  const base = (endpoint ?? DEFAULT_ENDPOINT).trim().replace(/\/+$/, '');
  return base.replace(/\/submit$/, '') || DEFAULT_ENDPOINT;
}

/** The kinds to offer: the caller's list filtered to known values, else all. */
export function resolveKinds(kinds: FeedbackKind[] | undefined): FeedbackKind[] {
  const valid = (kinds ?? []).filter((k) => ALL_KINDS.includes(k));
  return valid.length ? valid : ALL_KINDS;
}

export interface DraftInput {
  kind: FeedbackKind;
  title: string;
  body: string;
  email: string;
}

/**
 * Build the wire payload from the form state plus ambient page context. Only the
 * body is required — the API derives a title from it when one is not supplied,
 * so a single-textarea embed is a valid client.
 */
export function buildPayload(
  draft: DraftInput,
  opts: Pick<FeedbackWidgetOptions, 'appVersion' | 'context'>,
  page: { url?: string } = {},
): FeedbackPayload | { error: 'empty' } {
  const body = draft.body.trim();
  if (!body) return { error: 'empty' };
  const title = draft.title.trim();
  const email = draft.email.trim();
  return {
    kind: draft.kind,
    body,
    ...(title ? { title } : {}),
    ...(email ? { email } : {}),
    ...(page.url ? { url: page.url } : {}),
    ...(opts.appVersion ? { appVersion: opts.appVersion } : {}),
    ...(opts.context ? { context: opts.context } : {}),
  };
}

export interface SubmitOutcome {
  ok: boolean;
  submissionId?: string;
  deduped?: boolean;
  /** Distinguishes the "come back tomorrow" message from a generic failure. */
  rateLimited?: boolean;
}

/** POST one request to the collector. Never throws — the widget renders the outcome. */
export async function postFeedback(
  endpoint: string,
  key: string,
  payload: FeedbackPayload,
  fetchFn: typeof fetch = fetch,
): Promise<SubmitOutcome> {
  try {
    const res = await fetchFn(`${normalizeEndpoint(endpoint)}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
    });
    if (res.status === 429) return { ok: false, rateLimited: true };
    if (!res.ok) return { ok: false };
    const json = (await res.json().catch(() => null)) as { submissionId?: string; deduped?: boolean } | null;
    return { ok: true, submissionId: json?.submissionId, deduped: !!json?.deduped };
  } catch {
    return { ok: false };
  }
}

/** Merge caller label overrides onto the shipped English defaults. */
export function resolveLabels(overrides: Partial<FeedbackLabels> | undefined): FeedbackLabels {
  return { ...DEFAULT_LABELS, ...(overrides ?? {}) };
}

/** The label for a kind, from the resolved label set. */
export function kindLabel(kind: FeedbackKind, labels: FeedbackLabels): string {
  switch (kind) {
    case 'feature': return labels.kindFeature;
    case 'bug': return labels.kindBug;
    case 'idea': return labels.kindIdea;
    default: return labels.kindOther;
  }
}
