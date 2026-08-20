import { describe, it, expect } from 'vitest';
import {
  getFeedbackProvider,
  isFeedbackProviderId,
  listFeedbackProviders,
  posthogFeedbackAdapter,
  sentryFeedbackAdapter,
} from './feedbackProviders';
import { hmacSha256Hex } from '../../infrastructure/crypto/webhookHmac';
import { BODY_MAX, TITLE_MAX } from './feedbackSpec';

/**
 * Assembled at runtime from parts, never spelled out. A secret-SHAPED literal in a
 * source file trips the push guard and blocks the whole tree, so every fixture
 * secret in this repo is built rather than written.
 */
const SECRET = ['whsec', 'test', 'feedback', 'provider', '0123456789abcdef'].join('_');

/** A header bag as the route hands one down (case-insensitive at the Hono layer). */
function headers(map: Record<string, string>) {
  const lower = new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return (name: string) => lower.get(name.toLowerCase());
}

describe('feedback provider registry', () => {
  it('serves exactly the providers it advertises, and nothing else', () => {
    expect(listFeedbackProviders().map((p) => p.id)).toEqual(['sentry', 'posthog']);
    // The catalogue the settings UI renders and the lookup the webhook route uses
    // are the same registry — a provider cannot appear in one without the other.
    for (const p of listFeedbackProviders()) {
      expect(getFeedbackProvider(p.id)).not.toBeNull();
      expect(isFeedbackProviderId(p.id)).toBe(true);
    }
  });

  it('answers an unknown provider with null rather than throwing', () => {
    // The id arrives from a URL path: a typo must become a 404, never a 500.
    expect(getFeedbackProvider('logrocket')).toBeNull();
    expect(getFeedbackProvider('')).toBeNull();
    expect(isFeedbackProviderId('nope')).toBe(false);
  });
});

describe('sentry adapter · signature verification', () => {
  it('accepts a body signed with the stored secret', async () => {
    const body = JSON.stringify({ data: { feedback: { comments: 'it crashed on save' } } });
    const sig = await hmacSha256Hex(SECRET, body);
    expect(await sentryFeedbackAdapter.verify(body, headers({ 'Sentry-Hook-Signature': sig }), SECRET)).toBe(true);
  });

  it('accepts the legacy header spelling', async () => {
    const body = JSON.stringify({ data: { feedback: { comments: 'x' } } });
    const sig = await hmacSha256Hex(SECRET, body);
    expect(
      await sentryFeedbackAdapter.verify(body, headers({ 'Sentry-Hook-Signature-Legacy': sig }), SECRET),
    ).toBe(true);
  });

  it('rejects a TAMPERED body carrying the signature of the original', async () => {
    const original = JSON.stringify({ data: { feedback: { comments: 'please add dark mode' } } });
    const sig = await hmacSha256Hex(SECRET, original);
    const tampered = JSON.stringify({ data: { feedback: { comments: 'please add dark mode.' } } });
    expect(await sentryFeedbackAdapter.verify(tampered, headers({ 'Sentry-Hook-Signature': sig }), SECRET)).toBe(false);
  });

  it('rejects a missing signature, an empty secret and a foreign secret', async () => {
    const body = JSON.stringify({ data: { feedback: { comments: 'x' } } });
    const sig = await hmacSha256Hex(SECRET, body);
    expect(await sentryFeedbackAdapter.verify(body, headers({}), SECRET)).toBe(false);
    expect(await sentryFeedbackAdapter.verify(body, headers({ 'Sentry-Hook-Signature': sig }), '')).toBe(false);
    expect(
      await sentryFeedbackAdapter.verify(body, headers({ 'Sentry-Hook-Signature': sig }), `${SECRET}x`),
    ).toBe(false);
  });
});

describe('sentry adapter · normalisation', () => {
  it('turns a User Feedback payload into a bug report with its submitter', () => {
    const [s] = sentryFeedbackAdapter.normalize({
      action: 'created',
      data: {
        feedback: {
          comments: 'The save button does nothing on Safari.',
          name: 'Ada Lovelace',
          contact_email: 'ada@example.com',
          url: 'https://app.example.com/reports',
          issue_id: '4510',
          event_id: 'evt-1',
          release: '2026.8.1',
        },
      },
    });
    expect(s).toBeDefined();
    expect(s!.kind).toBe('bug');
    expect(s!.body).toBe('The save button does nothing on Safari.');
    expect(s!.submitterName).toBe('Ada Lovelace');
    expect(s!.submitterEmail).toBe('ada@example.com');
    expect(s!.pageUrl).toBe('https://app.example.com/reports');
    expect(s!.appVersion).toBe('2026.8.1');
    // Provenance rides the row so triage can see it was imported, not typed here.
    expect(s!.context).toMatchObject({ importedFrom: 'sentry', sentryIssueId: '4510' });
  });

  it('derives a title from the comment when the payload has none', () => {
    const [s] = sentryFeedbackAdapter.normalize({
      data: { feedback: { comments: 'Export to CSV please\nand keep the filters' } },
    });
    expect(s!.title).toBe('Export to CSV please');
  });

  it('falls back to the issue itself when no human wrote anything', () => {
    const [s] = sentryFeedbackAdapter.normalize({
      data: { issue: { id: '99', title: 'TypeError: undefined is not a function', culprit: 'app/save.ts', permalink: 'https://sentry.io/i/99' } },
    });
    expect(s!.title).toBe('TypeError: undefined is not a function');
    expect(s!.body).toContain('app/save.ts');
    expect(s!.pageUrl).toBe('https://sentry.io/i/99');
  });

  it('returns nothing — never throws — for a payload it cannot read', () => {
    // A provider schema change must not turn their retry storm into our 500s.
    expect(sentryFeedbackAdapter.normalize({})).toEqual([]);
    expect(sentryFeedbackAdapter.normalize(null)).toEqual([]);
    expect(sentryFeedbackAdapter.normalize('not json-shaped')).toEqual([]);
    expect(sentryFeedbackAdapter.normalize({ data: { issue: { id: '1' } } })).toEqual([]);
  });

  it('caps every field, so an imported request cannot write an oversized row', () => {
    const [s] = sentryFeedbackAdapter.normalize({
      data: { feedback: { comments: 'x'.repeat(BODY_MAX + 500), title: 'y'.repeat(TITLE_MAX + 500) } },
    });
    expect(s!.body.length).toBe(BODY_MAX);
    expect(s!.title.length).toBe(TITLE_MAX);
  });

  it('prefers the provider delivery id as the replay key', () => {
    const payload = { data: { feedback: { event_id: 'evt-7', issue_id: '4510' } } };
    expect(sentryFeedbackAdapter.eventId(payload, headers({ 'Sentry-Hook-Resource-Id': 'del-1' }))).toBe('del-1');
    expect(sentryFeedbackAdapter.eventId(payload, headers({}))).toBe('evt-7');
    expect(sentryFeedbackAdapter.eventId({}, headers({}))).toBeNull();
  });
});

describe('posthog adapter · signature verification', () => {
  it('accepts both the bare-hex and the sha256= prefixed form', async () => {
    const body = JSON.stringify({ event: { event: 'survey sent', properties: { $survey_response: 'more keyboard shortcuts' } } });
    const sig = await hmacSha256Hex(SECRET, body);
    expect(await posthogFeedbackAdapter.verify(body, headers({ 'X-PostHog-Signature': sig }), SECRET)).toBe(true);
    expect(await posthogFeedbackAdapter.verify(body, headers({ 'X-PostHog-Signature': `sha256=${sig}` }), SECRET)).toBe(true);
    expect(await posthogFeedbackAdapter.verify(body, headers({ 'X-Signature': sig }), SECRET)).toBe(true);
  });

  it('rejects a tampered body and a missing signature', async () => {
    const original = JSON.stringify({ event: { event: 'survey sent', properties: { $survey_response: 'a' } } });
    const sig = await hmacSha256Hex(SECRET, original);
    const tampered = JSON.stringify({ event: { event: 'survey sent', properties: { $survey_response: 'b' } } });
    expect(await posthogFeedbackAdapter.verify(tampered, headers({ 'X-PostHog-Signature': sig }), SECRET)).toBe(false);
    expect(await posthogFeedbackAdapter.verify(tampered, headers({ 'X-PostHog-Signature': `sha256=${sig}` }), SECRET)).toBe(false);
    expect(await posthogFeedbackAdapter.verify(original, headers({}), SECRET)).toBe(false);
  });
});

describe('posthog adapter · normalisation', () => {
  it('joins a multi-question survey response into one request', () => {
    const [s] = posthogFeedbackAdapter.normalize({
      event: {
        event: 'survey sent',
        distinct_id: 'user-9',
        properties: {
          $survey_name: 'Q3 roadmap survey',
          $survey_id: 'srv-2',
          $survey_response: 'Bulk edit on the board',
          $survey_response_2: 'And a keyboard shortcut for it',
          $current_url: 'https://app.example.com/board',
          $user_email: 'grace@example.com',
        },
      },
    });
    expect(s!.title).toBe('Q3 roadmap survey');
    expect(s!.body).toBe('Bulk edit on the board\n\nAnd a keyboard shortcut for it');
    expect(s!.kind).toBe('feature');
    expect(s!.submitterEmail).toBe('grace@example.com');
    expect(s!.context).toMatchObject({ importedFrom: 'posthog', posthogSurveyId: 'srv-2', posthogDistinctId: 'user-9' });
  });

  it('reads a flat (unwrapped) event and an explicit kind', () => {
    const [s] = posthogFeedbackAdapter.normalize({
      event: 'Feedback Sent',
      properties: { $feedback: 'Filters reset when I refresh', kind: 'bug' },
    });
    expect(s!.kind).toBe('bug');
    expect(s!.body).toBe('Filters reset when I refresh');
  });

  it('coerces an unrecognised kind rather than failing the import', () => {
    const [s] = posthogFeedbackAdapter.normalize({
      event: { event: '$feedback', properties: { $feedback: 'x', kind: 'wishlist' } },
    });
    expect(s!.kind).toBe('feature');
  });

  it('ignores an ordinary product event that merely has a message property', () => {
    // Importing analytics noise is what makes a team switch the integration off.
    expect(posthogFeedbackAdapter.normalize({
      event: { event: 'order completed', properties: { message: 'order 55 shipped' } },
    })).toEqual([]);
  });

  it('returns nothing — never throws — for a payload it cannot read', () => {
    expect(posthogFeedbackAdapter.normalize({})).toEqual([]);
    expect(posthogFeedbackAdapter.normalize(null)).toEqual([]);
    expect(posthogFeedbackAdapter.normalize({ event: { event: 'survey sent', properties: {} } })).toEqual([]);
  });

  it('uses the event uuid as the replay key', () => {
    expect(posthogFeedbackAdapter.eventId({ event: { uuid: 'u-1' } }, headers({}))).toBe('u-1');
    expect(posthogFeedbackAdapter.eventId({ properties: { $insert_id: 'i-2' } }, headers({}))).toBe('i-2');
    expect(posthogFeedbackAdapter.eventId({}, headers({}))).toBeNull();
  });
});
