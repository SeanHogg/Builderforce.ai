/**
 * Feedback provider adapters — the structural (Adapter pattern) translation seam
 * for importing requests from a tool a team already runs.
 *
 * We own the canonical submission shape (feedbackSpec.ts); each adapter knows how
 * to translate ONE provider's webhook payload into 0..N {@link NormalizedFeedback}.
 * Adding a provider is one adapter here plus one row in the registry — nothing
 * downstream changes, because the webhook route hands whatever comes back to the
 * SAME `submitFeedback` the snippet posts into. Deliberately the same shape as
 * `application/quality/adapters.ts`' `ErrorSourceAdapter` (and, beneath it,
 * boardsync's `PROVIDER_REGISTRY`), so a reader who has met one registry has met
 * all three.
 *
 * Three responsibilities, and the split matters:
 *
 *   verify()    authenticates the RAW body against the tenant's stored secret. It
 *               takes the raw string, never the parsed object, because a signature
 *               covers exact bytes: verifying a re-serialised payload would accept
 *               a tampered body whose JSON happens to round-trip identically.
 *   eventId()   the provider's own id for this delivery — the replay key. Webhook
 *               senders retry, and a retried delivery must not open a second
 *               ticket. Content fingerprinting cannot do this job on its own: two
 *               people can legitimately file the same words, while one provider
 *               retry is the same EVENT and must collapse even if it was edited.
 *   normalize() the translation. PURE (no IO), so it unit-tests against a captured
 *               payload with no database in sight.
 *
 * Adapters are TOLERANT by construction: a provider that adds a field, nests its
 * payload one level deeper, or sends an event we do not care about must produce an
 * empty array, never an exception — a throwing adapter turns a provider's retry
 * storm into an error budget we spend on their schema change.
 */

import { verifyHmacHex } from '../../infrastructure/crypto/webhookHmac';
import { normalizeFeedback, type FeedbackKind, type NormalizedFeedback } from './feedbackSpec';

/** Reads an inbound request header by name (case-insensitive at the Hono layer). */
export type HeaderGetter = (name: string) => string | undefined | null;

export const FEEDBACK_PROVIDER_IDS = ['sentry', 'posthog'] as const;
export type FeedbackProviderId = (typeof FEEDBACK_PROVIDER_IDS)[number];

export interface FeedbackProviderAdapter {
  /** Stable id — the `provider` value stored on the integration row and in the URL. */
  readonly id: FeedbackProviderId;
  /** Human label for the settings UI's provider picker. */
  readonly label: string;
  /** The header this provider signs with, echoed to the settings UI so an operator
   *  can see which field the secret belongs in on the other side. */
  readonly signatureHeader: string;
  /** Verify a signed webhook body against the tenant's stored secret. */
  verify(rawBody: string, getHeader: HeaderGetter, secret: string): Promise<boolean>;
  /** The provider's own delivery/event id — the replay-dedupe key. Null when the
   *  payload carries none, in which case the route falls back to hashing the body. */
  eventId(payload: unknown, getHeader: HeaderGetter): string | null;
  /** Translate a raw inbound payload into 0..N canonical submissions. Pure, tolerant. */
  normalize(payload: unknown): NormalizedFeedback[];
}

// ---------------------------------------------------------------------------
// Small tolerant readers (providers are untyped JSON over the wire)
// ---------------------------------------------------------------------------

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

/**
 * Funnel an adapter's extracted fields through the SAME normalizer the public
 * snippet posts into, instead of assembling a `NormalizedFeedback` by hand.
 *
 * This is what makes an imported request indistinguishable from a native one
 * downstream: identical length caps, identical title-from-first-line fallback,
 * identical kind coercion. An adapter that built the struct itself would be a
 * second definition of "a valid submission", and the first one to drift would put
 * an oversized row behind a door the snippet's caps were supposed to cover.
 */
function toSubmission(
  fields: {
    kind: FeedbackKind;
    title?: string | undefined;
    body: string | undefined;
    email?: string | undefined;
    name?: string | undefined;
    url?: string | undefined;
    appVersion?: string | undefined;
  },
  provider: FeedbackProviderId,
  context: Record<string, unknown>,
): NormalizedFeedback[] {
  if (!fields.body) return [];
  const result = normalizeFeedback({
    kind: fields.kind,
    title: fields.title,
    body: fields.body,
    email: fields.email,
    name: fields.name,
    url: fields.url,
    appVersion: fields.appVersion,
    // Provenance rides the submission so triage can see it arrived from a tool
    // rather than from this product's own widget.
    context: { ...context, importedFrom: provider },
  });
  return result.ok ? [result.value] : [];
}

// ---------------------------------------------------------------------------
// sentry — User Feedback (the crash-report dialog) and issue alerts.
// ---------------------------------------------------------------------------

/**
 * Sentry signs the raw body with HMAC-SHA256 hex under the integration's client
 * secret. Both header spellings are accepted: an Internal Integration sends
 * `Sentry-Hook-Signature`, while older installs and the legacy webhook plugin send
 * `Sentry-Hook-Signature-Legacy`.
 */
export const sentryFeedbackAdapter: FeedbackProviderAdapter = {
  id: 'sentry',
  label: 'Sentry',
  signatureHeader: 'Sentry-Hook-Signature',
  async verify(rawBody, getHeader, secret) {
    const sig = (getHeader('Sentry-Hook-Signature') ?? getHeader('Sentry-Hook-Signature-Legacy') ?? '').trim();
    if (!sig || !secret) return false;
    return verifyHmacHex(rawBody, sig, secret);
  },
  eventId(payload, getHeader) {
    const root = asRecord(payload);
    const data = asRecord(root.data);
    const fb = asRecord(data.feedback ?? root.feedback);
    const issue = asRecord(data.issue ?? root.issue);
    // Sentry stamps every delivery with a uuid header; prefer it, because it is
    // stable across the retries of ONE delivery and distinct between two genuine
    // deliveries that happen to describe the same issue.
    return str(getHeader('Sentry-Hook-Resource-Id'))
      ?? str(getHeader('Request-Id'))
      ?? str(fb.event_id)
      ?? str(root.id)
      ?? str(issue.id)
      ?? null;
  },
  normalize(payload) {
    const root = asRecord(payload);
    const data = asRecord(root.data);
    const fb = asRecord(data.feedback ?? root.feedback);

    // A User Feedback payload is a PERSON writing prose — the highest-value import.
    if (Object.keys(fb).length > 0) {
      return toSubmission(
        {
          // A crash-report comment is attached to an error, so it lands as a bug
          // report; a human can re-file it in triage if it is really a request.
          kind: 'bug',
          title: str(fb.title) ?? str(fb.issue_title),
          body: str(fb.comments) ?? str(fb.message),
          email: str(fb.contact_email) ?? str(fb.email),
          name: str(fb.name),
          url: str(fb.url) ?? str(fb.issue_url),
          appVersion: str(fb.release),
        },
        'sentry',
        { sentryIssueId: str(fb.issue_id) ?? null, sentryEventId: str(fb.event_id) ?? null },
      );
    }

    // An issue alert carries no human prose, so the issue itself becomes the
    // request: a triager still wants it on the board, clearly marked as imported.
    const issue = asRecord(data.issue ?? root.issue);
    const title = str(issue.title) ?? str(asRecord(issue.metadata).value);
    if (!title) return [];
    const culprit = str(issue.culprit);
    return toSubmission(
      {
        kind: 'bug',
        title,
        body: culprit ? `${title}\n\n${culprit}` : title,
        url: str(issue.permalink) ?? str(issue.web_url),
      },
      'sentry',
      { sentryIssueId: str(issue.id) ?? null, sentryShortId: str(issue.shortId) ?? null },
    );
  },
};

// ---------------------------------------------------------------------------
// posthog — survey responses and the `Feedback Sent` / `$feedback` event.
// ---------------------------------------------------------------------------

/**
 * PostHog signs webhook bodies with HMAC-SHA256, sent either as bare hex or
 * prefixed `sha256=` depending on the destination's age. Both are accepted; a
 * missing or empty signature is a rejection, never a pass-through.
 */
export const posthogFeedbackAdapter: FeedbackProviderAdapter = {
  id: 'posthog',
  label: 'PostHog',
  signatureHeader: 'X-PostHog-Signature',
  async verify(rawBody, getHeader, secret) {
    const sig = (getHeader('X-PostHog-Signature') ?? getHeader('X-Signature') ?? '').trim();
    if (!sig || !secret) return false;
    return sig.startsWith('sha256=')
      ? verifyHmacHex(rawBody, sig, secret, 'sha256=')
      : verifyHmacHex(rawBody, sig, secret);
  },
  eventId(payload) {
    const root = asRecord(payload);
    const ev = asRecord(root.event ?? root);
    return str(ev.uuid)
      ?? str(root.uuid)
      ?? str(asRecord(ev.properties).$insert_id)
      ?? str(asRecord(root.properties).$insert_id)
      ?? null;
  },
  normalize(payload) {
    const root = asRecord(payload);
    // PostHog wraps the event under `event` on newer destinations and sends it
    // flat on older ones; tolerate both rather than guessing from the payload.
    const ev = asRecord(root.event ?? root);
    const props = asRecord(ev.properties ?? root.properties);
    const name = (str(ev.event) ?? str(root.event_name) ?? '').toLowerCase();

    // A survey response arrives as `survey sent` with the answers on
    // `$survey_response` (and `$survey_response_<id>` per question).
    const surveyAnswers = Object.entries(props)
      .filter(([k, v]) => k.startsWith('$survey_response') && typeof v === 'string' && v.trim() !== '')
      .map(([, v]) => String(v).trim());

    const body = surveyAnswers.length > 0
      ? surveyAnswers.join('\n\n')
      : str(props.$feedback) ?? str(props.feedback) ?? str(props.message) ?? str(props.comment);
    if (!body) return [];

    // Only events that actually CARRY feedback are imported. An arbitrary product
    // event that happens to have a `message` property is not a request, and taking
    // it would fill a human's triage queue with analytics noise — the failure that
    // makes a team turn the integration off.
    const isFeedbackEvent =
      surveyAnswers.length > 0
      || name.includes('feedback')
      || name.includes('survey')
      || props.$feedback !== undefined
      || props.feedback !== undefined;
    if (!isFeedbackEvent) return [];

    const declared = (str(props.kind) ?? str(props.$feedback_type) ?? '').toLowerCase();
    const kind: FeedbackKind = declared === 'bug' || declared === 'idea' || declared === 'other'
      ? declared
      : 'feature';

    return toSubmission(
      {
        kind,
        title: str(props.$survey_name) ?? str(props.title),
        body,
        email: str(props.$user_email) ?? str(props.email),
        name: str(props.$user_name) ?? str(props.name),
        url: str(props.$current_url),
        appVersion: str(props.$app_version),
      },
      'posthog',
      {
        posthogDistinctId: str(ev.distinct_id) ?? str(root.distinct_id) ?? null,
        posthogSurveyId: str(props.$survey_id) ?? null,
      },
    );
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const FEEDBACK_PROVIDERS: Record<FeedbackProviderId, FeedbackProviderAdapter> = {
  sentry: sentryFeedbackAdapter,
  posthog: posthogFeedbackAdapter,
};

/** Is this a provider id we can actually serve a webhook for? */
export function isFeedbackProviderId(id: string): id is FeedbackProviderId {
  return (FEEDBACK_PROVIDER_IDS as readonly string[]).includes(id);
}

/**
 * Look up an adapter by provider id; null for anything unknown. Null rather than a
 * throw because the id arrives from a URL path: an unrecognised provider is a bad
 * request (404), not an internal fault, and a throwing lookup on a PUBLIC route
 * would turn a typo into a 500 in the error budget.
 */
export function getFeedbackProvider(id: string): FeedbackProviderAdapter | null {
  return isFeedbackProviderId(id) ? FEEDBACK_PROVIDERS[id] : null;
}

/** The provider catalogue the settings UI renders its picker from — ONE source, so
 *  a provider can never appear in the UI without an adapter behind it. */
export function listFeedbackProviders(): Array<{ id: FeedbackProviderId; label: string; signatureHeader: string }> {
  return FEEDBACK_PROVIDER_IDS.map((id) => {
    const a = FEEDBACK_PROVIDERS[id];
    return { id: a.id, label: a.label, signatureHeader: a.signatureHeader };
  });
}
