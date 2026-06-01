import { describe, expect, it } from 'vitest';
import { verifyWebhookSignature, normalizeWebhookPayload } from './webhookIngest';

async function sign(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `sha256=${hex}`;
}

describe('verifyWebhookSignature', () => {
  it('accepts a correct signature', async () => {
    const body = '{"hello":"world"}';
    const sig = await sign(body, 'topsecret');
    expect(await verifyWebhookSignature(body, sig, 'topsecret')).toBe(true);
  });

  it('rejects a tampered body', async () => {
    const sig = await sign('{"hello":"world"}', 'topsecret');
    expect(await verifyWebhookSignature('{"hello":"mars"}', sig, 'topsecret')).toBe(false);
  });

  it('rejects the wrong secret', async () => {
    const body = '{"a":1}';
    const sig = await sign(body, 'right');
    expect(await verifyWebhookSignature(body, sig, 'wrong')).toBe(false);
  });

  it('rejects malformed / missing headers', async () => {
    expect(await verifyWebhookSignature('x', '', 's')).toBe(false);
    expect(await verifyWebhookSignature('x', 'sha1=abc', 's')).toBe(false);
    expect(await verifyWebhookSignature('x', 'sha256=', 's')).toBe(false);
  });
});

describe('normalizeWebhookPayload — github', () => {
  it('normalizes an issue event', () => {
    const t = normalizeWebhookPayload('github', {
      issue: {
        number: 12,
        title: 'Bug',
        body: 'broken',
        html_url: 'https://github.com/o/r/issues/12',
        state: 'open',
        updated_at: '2024-03-03T00:00:00Z',
        user: { login: 'alice', type: 'User' },
      },
      sender: { login: 'alice', type: 'User' },
    });
    expect(t).not.toBeNull();
    expect(t!.externalId).toBe('12');
    expect(t!.externalVersion).toBe('2024-03-03T00:00:00Z');
    expect(t!.originatedLocally).toBe(false);
    expect(t!.fields).toEqual({ title: 'Bug', body: 'broken', state: 'open' });
  });

  it('flags bot-authored events as locally originated (echo)', () => {
    const t = normalizeWebhookPayload('github', {
      issue: { number: 1, title: 'x', body: '', html_url: 'u', state: 'open', updated_at: 'v' },
      sender: { login: 'builderforce[bot]', type: 'Bot' },
    });
    expect(t!.originatedLocally).toBe(true);
  });

  it('returns null when there is no issue', () => {
    expect(normalizeWebhookPayload('github', { sender: { login: 'a' } })).toBeNull();
  });
});

describe('normalizeWebhookPayload — jira', () => {
  it('normalizes an issue event', () => {
    const t = normalizeWebhookPayload('jira', {
      issue: {
        key: 'PROJ-3',
        self: 'https://x.atlassian.net/rest/api/3/issue/3',
        fields: { summary: 'Title', description: 'Body', updated: '2024-04-04T00:00:00.000+0000', status: { name: 'In Progress' } },
      },
    });
    expect(t!.externalId).toBe('PROJ-3');
    expect(t!.state).toBe('In Progress');
    expect(t!.externalVersion).toBe('2024-04-04T00:00:00.000+0000');
  });

  it('returns null without an issue key', () => {
    expect(normalizeWebhookPayload('jira', { issue: { fields: { summary: 'x' } } })).toBeNull();
  });
});

describe('normalizeWebhookPayload — unknown provider', () => {
  it('returns null', () => {
    expect(normalizeWebhookPayload('trello', { card: {} })).toBeNull();
  });
});
