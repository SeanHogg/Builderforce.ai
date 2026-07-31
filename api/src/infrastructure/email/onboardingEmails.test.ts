import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendWelcomeEmail, sendAccountTypeSelectedEmail } from './EmailService';
import { resolveAppBaseUrl } from '../../env';

function stubFetch() {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** The JSON body Resend was POSTed on the Nth call. */
function sentBody(fn: ReturnType<typeof stubFetch>, call = 0) {
  return JSON.parse(fn.mock.calls[call]![1]!.body as string) as {
    to: string[];
    subject: string;
    html: string;
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('resolveAppBaseUrl', () => {
  it('takes the first origin of a comma-separated allow-list and strips the trailing slash', () => {
    expect(resolveAppBaseUrl({ APP_URL: 'https://builderforce.ai/, https://staging.x' }))
      .toBe('https://builderforce.ai');
  });

  it('falls back to the production origin', () => {
    expect(resolveAppBaseUrl({})).toBe('https://builderforce.ai');
  });
});

describe('sendWelcomeEmail', () => {
  it('posts a welcome message linking to the dashboard', async () => {
    const fetchMock = stubFetch();

    await sendWelcomeEmail(
      { RESEND_API_KEY: 'test-key' },
      'new@example.com',
      'Ada',
      'https://builderforce.ai',
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const body = sentBody(fetchMock);
    expect(body.to).toEqual(['new@example.com']);
    expect(body.subject).toBe('Welcome to Builderforce');
    expect(body.html).toContain('Hi Ada,');
    expect(body.html).toContain('https://builderforce.ai/dashboard');
  });

  it('falls back to the address when the provider gave no display name', async () => {
    const fetchMock = stubFetch();
    await sendWelcomeEmail({ RESEND_API_KEY: 'k' }, 'new@example.com', '', 'https://builderforce.ai');
    expect(sentBody(fetchMock).html).toContain('Hi new@example.com,');
  });

  it('is a no-op when email delivery is unconfigured', async () => {
    const fetchMock = stubFetch();
    await sendWelcomeEmail({}, 'new@example.com', 'Ada', 'https://builderforce.ai');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('carries the role-specific next steps when the role is known at signup', async () => {
    const fetchMock = stubFetch();
    await sendWelcomeEmail({ RESEND_API_KEY: 'k' }, 'gig@example.com', 'Ada', 'https://builderforce.ai', 'freelancer');
    const { html } = sentBody(fetchMock);
    expect(html).toContain('Complete your profile');
    expect(html).toContain('https://builderforce.ai/freelancer/profile');
    // The builder CTA must not leak into a gig account's mail.
    expect(html).not.toContain('Hire an agent');
  });

  it('omits role-specific steps when the role is not yet known (OAuth signup)', async () => {
    const fetchMock = stubFetch();
    await sendWelcomeEmail({ RESEND_API_KEY: 'k' }, 'new@example.com', 'Ada', 'https://builderforce.ai');
    const { html } = sentBody(fetchMock);
    expect(html).not.toContain('Hire an agent');
    expect(html).not.toContain('Complete your profile');
    expect(html).toContain('Get started');
  });
});

describe('sendAccountTypeSelectedEmail', () => {
  it('gives a builder the project / agent / team next steps', async () => {
    const fetchMock = stubFetch();
    await sendAccountTypeSelectedEmail(
      { RESEND_API_KEY: 'k' }, 'build@example.com', 'Ada', 'https://builderforce.ai', 'standard',
    );
    const { subject, html } = sentBody(fetchMock);
    expect(subject).toBe('Your Builderforce workspace is ready');
    expect(html).toContain('Create a project');
    expect(html).toContain('Hire an agent');
    expect(html).toContain('Invite your team');
    expect(html).toContain('https://builderforce.ai/dashboard');
  });

  it('gives a hired account the profile / publish / gigs next steps', async () => {
    const fetchMock = stubFetch();
    await sendAccountTypeSelectedEmail(
      { RESEND_API_KEY: 'k' }, 'gig@example.com', 'Ada', 'https://builderforce.ai', 'freelancer',
    );
    const { subject, html } = sentBody(fetchMock);
    expect(subject).toBe("You're set up to find work on Builderforce");
    expect(html).toContain('Complete your profile');
    expect(html).toContain('Browse open gigs');
    expect(html).toContain('https://builderforce.ai/freelancer/profile');
    expect(html).not.toContain('/dashboard');
  });

  it('reuses the exact next-steps copy the welcome email uses for the same role', async () => {
    // Guards the DRY contract: the two templates share NEXT_STEPS, so a role's
    // steps must never drift between the signup mail and the role-choice mail.
    const welcomeFetch = stubFetch();
    await sendWelcomeEmail({ RESEND_API_KEY: 'k' }, 'a@example.com', 'Ada', 'https://builderforce.ai', 'standard');
    const welcome = sentBody(welcomeFetch).html;
    vi.unstubAllGlobals();

    const choiceFetch = stubFetch();
    await sendAccountTypeSelectedEmail({ RESEND_API_KEY: 'k' }, 'a@example.com', 'Ada', 'https://builderforce.ai', 'standard');
    const choice = sentBody(choiceFetch).html;

    for (const step of ['Create a project', 'Hire an agent', 'Invite your team']) {
      expect(welcome).toContain(step);
      expect(choice).toContain(step);
    }
  });

  it('is a no-op when email delivery is unconfigured', async () => {
    const fetchMock = stubFetch();
    await sendAccountTypeSelectedEmail({}, 'a@example.com', 'Ada', 'https://builderforce.ai', 'standard');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
