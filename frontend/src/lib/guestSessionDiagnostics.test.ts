import { describe, it, expect } from 'vitest';
import {
  buildGuestSessionReport,
  funnelOutcome,
  sessionSpanMs,
  MAX_PROMPT_CHARS,
  PROMPT_WINDOW_HEAD,
  PROMPT_WINDOW_TAIL,
} from './guestSessionDiagnostics';
import type { AdminGuestPrompt, AdminGuestSession } from './adminApi';

/**
 * The fixture is the row that motivated the change: a real lead whose intent is a
 * 900-character course brief, whose history is 84 prompts long, and who converted.
 * Everything the table row cannot show is what these tests hold.
 */
const ctx = {
  capturedAt: '2026-08-12T11:20:00.000Z',
  uiVersion: '2026.8.12',
  apiVersion: '2026.8.30',
  sourceUrl: 'https://builderforce.ai/admin?tab=users&sub=sessions',
};

const SESSION: AdminGuestSession = {
  id: 'ms_1',
  visitorId: 'GX_aqxhgG1C9FzvrBp6B2W8e',
  guestChatCount: 10,
  guestChatTokens: 197_226,
  toolRuns: 1,
  landingPath: '/brainstorm',
  referrer: 'https://news.ycombinator.com/',
  converted: true,
  convertedUserId: 'u_42',
  convertedEmail: 'seanhogg@gmail.com',
  convertedAt: '2026-08-12T11:14:00.000Z',
  firstSeenAt: '2026-07-05T23:54:00.000Z',
  lastSeenAt: '2026-08-12T11:14:00.000Z',
  isPaid: false,
  promptCount: 84,
  firstPrompt: 'Create a complete interactive LMS course on the Canvas that teaches me Entrepreneurship.',
  lastPrompt: 'Begin by asking about my experience level and goal.',
  lastPromptAt: '2026-08-12T11:14:00.000Z',
  lastSurface: 'canvas',
};

const prompt = (id: number, text: string): AdminGuestPrompt => ({
  id: `p_${id}`,
  prompt: text,
  surface: 'canvas',
  sessionRef: 'cs_9',
  mode: 'work',
  createdAt: `2026-08-1${id % 10}T09:00:00.000Z`,
});

describe('funnelOutcome', () => {
  it('ranks paid above registered, so a paying convert is never reported as merely registered', () => {
    expect(funnelOutcome({ ...SESSION, isPaid: true })).toBe('paid');
    expect(funnelOutcome(SESSION)).toBe('registered');
    expect(funnelOutcome({ ...SESSION, converted: false, convertedEmail: null })).toBe('guest');
  });
});

describe('sessionSpanMs', () => {
  it('measures first touch to last touch', () => {
    expect(sessionSpanMs(SESSION)).toBe(
      Date.parse(SESSION.lastSeenAt) - Date.parse(SESSION.firstSeenAt),
    );
  });

  it('degrades an unparseable stamp to null rather than to a NaN duration', () => {
    expect(sessionSpanMs({ ...SESSION, firstSeenAt: 'not a date' })).toBeNull();
  });
});

describe('buildGuestSessionReport', () => {
  it('leads with the build stamp and the funnel standing', () => {
    const report = buildGuestSessionReport({ session: SESSION, prompts: [] }, ctx);
    expect(report.indexOf('-- Environment --')).toBeLessThan(report.indexOf('-- Standing --'));
    expect(report.indexOf('-- Standing --')).toBeLessThan(report.indexOf('-- Engagement --'));
    expect(report).toContain('uiVersion: 2026.8.12');
    expect(report).toContain('visitorId: GX_aqxhgG1C9FzvrBp6B2W8e');
    expect(report).toContain('outcome: registered');
    expect(report).toContain('convertedEmail: seanhogg@gmail.com');
  });

  it('reports the engagement numbers the row only summarises', () => {
    const report = buildGuestSessionReport({ session: SESSION, prompts: [] }, ctx);
    expect(report).toContain('brainTokens: 197226');
    expect(report).toContain('toolRuns: 1');
    expect(report).toContain('activeSpan: 37d 11h');
  });

  // The distinction the whole `prompts: null` branch exists for: an unavailable
  // history that renders as an empty one turns a missing fact into a confident zero.
  it('distinguishes a history that could not be loaded from one that is empty', () => {
    const failed = buildGuestSessionReport(
      { session: SESSION, prompts: null, promptsError: 'HTTP 500' },
      ctx,
    );
    expect(failed).toContain('84 recorded, not loaded');
    expect(failed).toContain('could not be loaded: HTTP 500');
    expect(failed).not.toContain('no prompts recorded');

    const empty = buildGuestSessionReport(
      { session: { ...SESSION, promptCount: 0 }, prompts: [] },
      ctx,
    );
    expect(empty).toContain('(no prompts recorded for this visitor)');
    expect(empty).not.toContain('could not be loaded');
  });

  it('windows a long history and ANNOUNCES what it dropped', () => {
    const prompts = Array.from({ length: 84 }, (_, i) => prompt(i, `prompt number ${i}`));
    const report = buildGuestSessionReport({ session: SESSION, prompts }, ctx);

    expect(report).toContain('-- Prompt history (84) --');
    expect(report).toContain(`… ${84 - PROMPT_WINDOW_HEAD - PROMPT_WINDOW_TAIL} prompts elided …`);
    // Both ends survive: the intent they arrived with and where they gave up.
    expect(report).toContain('prompt number 0');
    expect(report).toContain('prompt number 83');
    // Numbering reflects the true position in the full history, not the slice.
    expect(report).toContain('84. [');
  });

  it('caps one enormous prompt in the prose and states how much it dropped', () => {
    const huge = 'x'.repeat(MAX_PROMPT_CHARS + 500);
    const report = buildGuestSessionReport({ session: SESSION, prompts: [prompt(1, huge)] }, ctx);
    expect(report).toContain('(+500 chars)');
    // Only the PROSE is capped — the JSON appendix below it deliberately carries
    // the payload verbatim, so bounding the whole report would assert the opposite
    // of what the appendix is for.
    const prose = report.slice(0, report.indexOf('-- Raw payload (JSON) --'));
    expect(prose).not.toContain('x'.repeat(MAX_PROMPT_CHARS + 1));
  });

  it('appends a re-parseable JSON payload', () => {
    const report = buildGuestSessionReport({ session: SESSION, prompts: [prompt(1, 'hi')] }, ctx);
    const json = report.slice(report.indexOf('-- Raw payload (JSON) --') + '-- Raw payload (JSON) --'.length);
    const parsed = JSON.parse(json);
    expect(parsed.session.visitorId).toBe(SESSION.visitorId);
    expect(parsed.prompts).toHaveLength(1);
  });
});
