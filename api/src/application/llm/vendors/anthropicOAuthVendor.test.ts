import { afterEach, describe, expect, it, vi } from 'vitest';
import { anthropicModule } from './anthropic';
import { CLAUDE_CODE_SYSTEM_PROMPT } from '../anthropicOAuth';

// The anthropic vendor must authenticate a connected tenant SUBSCRIPTION (OAuth)
// with Bearer + the oauth beta header + the Claude Code identity system block —
// and an operator API key with x-api-key and no identity injection.

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const originalFetch = globalThis.fetch;
afterEach(() => { (globalThis as { fetch: typeof fetch }).fetch = originalFetch; });

function capture(): { headers: () => Record<string, string>; body: () => any } {
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: any = null;
  const fn = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url !== ANTHROPIC_ENDPOINT) throw new Error(`unmocked: ${url}`);
    capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
    capturedBody = JSON.parse(String(init?.body ?? '{}'));
    return new Response(
      JSON.stringify({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
  (globalThis as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return { headers: () => capturedHeaders, body: () => capturedBody };
}

const baseMessages = [
  { role: 'system', content: 'Repo context.' },
  { role: 'user', content: 'Fix the bug.' },
];

describe('anthropic vendor — apiKeyFrom', () => {
  it('prefers a tenant subscription token (oauth: sentinel) over the operator key', () => {
    expect(anthropicModule.apiKeyFrom({ CLAUDE_OAUTH_TOKEN: 'sk-ant-oat-123', CLAUDE_API_KEY: 'sk-ant-key' }))
      .toBe('oauth:sk-ant-oat-123');
  });
  it('falls back to the operator API key when no subscription is connected', () => {
    expect(anthropicModule.apiKeyFrom({ CLAUDE_API_KEY: 'sk-ant-key' })).toBe('sk-ant-key');
  });
  it('returns null when neither is bound', () => {
    expect(anthropicModule.apiKeyFrom({})).toBeNull();
  });
});

describe('anthropic vendor — subscription (OAuth) call', () => {
  it('uses Bearer + oauth beta, drops x-api-key, and injects the Claude Code identity', async () => {
    const cap = capture();
    await anthropicModule.call({ apiKey: 'oauth:sk-ant-oat-123', model: 'claude-sonnet-4-6', messages: baseMessages });

    const h = cap.headers();
    expect(h['authorization']).toBe('Bearer sk-ant-oat-123');
    expect(h['anthropic-beta']).toBe('oauth-2025-04-20');
    expect(h['x-api-key']).toBeUndefined();

    const body = cap.body();
    // First system block is the required Claude Code identity; the repo context follows.
    expect(body.system[0].text).toBe(CLAUDE_CODE_SYSTEM_PROMPT);
    expect(body.system[body.system.length - 1].text).toContain('Repo context.');
  });
});

describe('anthropic vendor — credential hygiene (code-0 root cause)', () => {
  it('TRIMS a subscription token carrying a stray newline so the Authorization header is valid', async () => {
    // A raw `Bearer <token\n>` value makes fetch() throw `invalid header value`
    // SYNCHRONOUSLY — the cascade records that as a code-0 "no response" network
    // failure. Trimming is what keeps the connected account usable.
    const cap = capture();
    await anthropicModule.call({ apiKey: 'oauth:sk-ant-oat-123\n', model: 'claude-sonnet-4-6', messages: baseMessages });
    expect(cap.headers()['authorization']).toBe('Bearer sk-ant-oat-123');
  });

  it('surfaces an EMPTY subscription token as a clear auth error (not a mystifying network throw)', async () => {
    capture();
    await expect(
      anthropicModule.call({ apiKey: 'oauth:   ', model: 'claude-sonnet-4-6', messages: baseMessages }),
    ).rejects.toMatchObject({ status: 401, vendorId: 'anthropic' });
  });
});

describe('anthropic vendor — operator API-key call (unchanged)', () => {
  it('uses x-api-key, no Bearer/oauth beta, and no identity injection', async () => {
    const cap = capture();
    await anthropicModule.call({ apiKey: 'sk-ant-key', model: 'claude-sonnet-4-6', messages: baseMessages });

    const h = cap.headers();
    expect(h['x-api-key']).toBe('sk-ant-key');
    expect(h['authorization']).toBeUndefined();
    expect(h['anthropic-beta']).toBeUndefined();

    const body = cap.body();
    // Only the caller's system text — no Claude Code identity block prepended.
    expect(body.system[0].text).toContain('Repo context.');
    expect(JSON.stringify(body.system)).not.toContain(CLAUDE_CODE_SYSTEM_PROMPT);
  });
});
