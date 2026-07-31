/**
 * The templates actually render in the requested language.
 *
 * `emailLocale.test.ts` proves the CATALOG is complete and translated; this file
 * proves the TEMPLATES read from it — the two failure modes it guards are a
 * template that still holds a hardcoded English string, and one that forgets to
 * thread `locale` through at all (which would look fine in review because the
 * English output is unchanged).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  sendMagicLinkEmail,
  sendVerificationCodeEmail,
  sendWelcomeEmail,
  sendAccountTypeSelectedEmail,
  sendAdminPasswordResetEmail,
  sendWorkspaceInviteEmail,
  sendChatInviteEmail,
  sendReportEmail,
  sendLlmHealthAlertEmail,
} from './EmailService';
import { EMAIL_LOCALES, type EmailLocale } from './emailLocale';
import { EMAIL_MESSAGES } from './emailMessages';

function stubFetch() {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

function sentBody(fn: ReturnType<typeof stubFetch>, call = 0) {
  return JSON.parse(fn.mock.calls[call]![1]!.body as string) as {
    to: string[]; subject: string; html: string;
  };
}

const ENV = { RESEND_API_KEY: 'k' };

afterEach(() => vi.unstubAllGlobals());

describe('locale reaches every template', () => {
  it.each(EMAIL_LOCALES)('magic link renders in %s', async (locale) => {
    const fetchMock = stubFetch();
    await sendMagicLinkEmail(ENV, 'a@example.com', 'Ada', 'https://x/y', null, locale);
    const { subject, html } = sentBody(fetchMock);
    const copy = EMAIL_MESSAGES[locale];
    expect(subject).toBe(copy.magicLink.subject);
    expect(html).toContain(copy.magicLink.cta);
    // The `lang` attribute matters for screen readers and for Gmail's
    // "translate this message?" prompt.
    expect(html).toContain(`<html lang="${locale}"`);
  });

  it.each(EMAIL_LOCALES)('verification code renders in %s and keeps the code', async (locale) => {
    const fetchMock = stubFetch();
    await sendVerificationCodeEmail(ENV, 'a@example.com', 'Ada', '123456', null, locale);
    const { subject, html } = sentBody(fetchMock);
    expect(subject).toBe(EMAIL_MESSAGES[locale].verificationCode.subject.replace('{{Code}}', '123456'));
    expect(html).toContain('123456');
    expect(html).toContain(EMAIL_MESSAGES[locale].verificationCode.expiry);
  });

  it.each(EMAIL_LOCALES)('welcome renders its next steps in %s', async (locale) => {
    const fetchMock = stubFetch();
    await sendWelcomeEmail(ENV, 'a@example.com', 'Ada', 'https://app', 'standard', locale);
    const { subject, html } = sentBody(fetchMock);
    const copy = EMAIL_MESSAGES[locale];
    expect(subject).toBe(copy.welcome.subject);
    for (const step of copy.nextSteps.standard.steps) expect(html).toContain(step.label);
    // Routes are NOT translated — the CTA must still point at a real path.
    expect(html).toContain('https://app/dashboard');
  });

  it.each(EMAIL_LOCALES)('account-type-selected renders in %s for a freelancer', async (locale) => {
    const fetchMock = stubFetch();
    await sendAccountTypeSelectedEmail(ENV, 'a@example.com', 'Ada', 'https://app', 'freelancer', locale);
    const { subject, html } = sentBody(fetchMock);
    const copy = EMAIL_MESSAGES[locale];
    expect(subject).toBe(copy.accountTypeSelected.subjectFreelancer);
    for (const step of copy.nextSteps.freelancer.steps) expect(html).toContain(step.label);
    expect(html).toContain('https://app/freelancer/profile');
  });

  it.each(EMAIL_LOCALES)('admin reset renders in %s', async (locale) => {
    const fetchMock = stubFetch();
    await sendAdminPasswordResetEmail(ENV, 'a@example.com', 'https://x/magic', locale);
    const { subject, html } = sentBody(fetchMock);
    expect(subject).toBe(EMAIL_MESSAGES[locale].adminReset.subject);
    expect(html).toContain(EMAIL_MESSAGES[locale].adminReset.cta);
  });

  it.each(EMAIL_LOCALES)('workspace invite renders in %s', async (locale) => {
    const fetchMock = stubFetch();
    await sendWorkspaceInviteEmail(ENV, 'a@example.com', {
      workspaceName: 'Acme', inviterName: 'Ada', signupUrl: 'https://x/r', role: 'member', locale,
    });
    const { subject, html } = sentBody(fetchMock);
    expect(subject).toContain('Acme');
    expect(subject).toContain('Ada');
    expect(html).toContain(EMAIL_MESSAGES[locale].workspaceInvite.cta);
  });

  it.each(EMAIL_LOCALES)('chat invite renders in %s', async (locale) => {
    const fetchMock = stubFetch();
    await sendChatInviteEmail(ENV, 'a@example.com', {
      chatTitle: 'Roadmap', inviterName: 'Ada', chatUrl: 'https://x/c', locale,
    });
    const { subject, html } = sentBody(fetchMock);
    expect(subject).toContain('Ada');
    expect(html).toContain('Roadmap');
    expect(html).toContain(EMAIL_MESSAGES[locale].chatInvite.cta);
  });

  it.each(EMAIL_LOCALES)('report digest renders its chrome and column headers in %s', async (locale) => {
    const fetchMock = stubFetch();
    await sendReportEmail(ENV, 'a@example.com', 'Weekly', {
      reportType: 'project_status',
      projects: [{ name: 'Apollo', verdict: 'ok', deployments: 3 }],
    }, locale);
    const { html } = sentBody(fetchMock);
    const copy = EMAIL_MESSAGES[locale].report;
    expect(html).toContain(copy.cta);
    expect(html).toContain(copy.sectionProjects);
    expect(html).toContain(copy.columns.deploys);
    // The data itself is never translated.
    expect(html).toContain('Apollo');
  });

  it.each(EMAIL_LOCALES)('llm health alert localizes the body but not the subject in %s', async (locale) => {
    const fetchMock = stubFetch();
    await sendLlmHealthAlertEmail(ENV, 'ops@example.com', [{
      vendor: 'openrouter', previousStatus: 'ok', currentStatus: 'degraded',
      okCount: 2, failedCount: 1, probedCount: 3, failedModels: ['m1'],
    }], '2026-07-19T00:00:00Z', locale);
    const { subject, html } = sentBody(fetchMock);
    // Ops tooling greps this subject — it must stay stable across languages.
    expect(subject).toBe('[Builderforce] LLM vendor health changed — openrouter=degraded');
    expect(html).toContain(EMAIL_MESSAGES[locale].llmHealth.columnVendor);
  });
});

describe('English remains the default', () => {
  it('renders English when no locale is passed at all', async () => {
    // Backwards-compat guard: an un-migrated caller must behave exactly as before.
    const fetchMock = stubFetch();
    await sendWelcomeEmail(ENV, 'a@example.com', 'Ada', 'https://app', 'standard');
    const { subject, html } = sentBody(fetchMock);
    expect(subject).toBe('Welcome to Builderforce');
    expect(html).toContain('Hi Ada,');
    expect(html).toContain('Create a project');
  });
});

describe('transactional mail carries no unsubscribe link', () => {
  // The footer only grows an opt-out when a lifecycle sender supplies a URL, and
  // none of these senders can. A regression here is a compliance/UX problem in
  // BOTH directions: an opt-out on a password reset is as wrong as a missing one
  // on a marketing blast.
  const senders: [string, (locale: EmailLocale) => Promise<void>][] = [
    ['magic link', (l) => sendMagicLinkEmail(ENV, 'a@x.com', 'Ada', 'https://x/y', null, l)],
    ['verification', (l) => sendVerificationCodeEmail(ENV, 'a@x.com', 'Ada', '123456', null, l)],
    ['welcome', (l) => sendWelcomeEmail(ENV, 'a@x.com', 'Ada', 'https://app', 'standard', l)],
    ['admin reset', (l) => sendAdminPasswordResetEmail(ENV, 'a@x.com', 'https://x/m', l)],
  ];

  it.each(senders)('%s has no unsubscribe footer', async (_name, send) => {
    const fetchMock = stubFetch();
    await send('de');
    const { html } = sentBody(fetchMock);
    expect(html).not.toContain('unsubscribe');
    expect(html).not.toContain(EMAIL_MESSAGES.de.common.unsubscribeLabel);
    // The copyright footer is still there — this is not "no footer at all".
    expect(html).toContain('Builderforce');
  });
});
