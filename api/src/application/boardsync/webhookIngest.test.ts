import { describe, expect, it } from 'vitest';
import { verifyWebhookSignature, verifyProviderWebhookSignature, normalizeWebhookPayload } from './webhookIngest';

async function hmacBytes(body: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
}

async function hmacHex(body: string, secret: string): Promise<string> {
  return Array.from(await hmacBytes(body, secret)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacB64Url(body: string, secret: string): Promise<string> {
  let bin = '';
  for (const b of await hmacBytes(body, secret)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(body: string, secret: string): Promise<string> {
  return `sha256=${await hmacHex(body, secret)}`;
}

/** Build a case-insensitive header getter from a plain map. */
function headerGetter(map: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return (name: string) => lower[name.toLowerCase()];
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

describe('verifyProviderWebhookSignature', () => {
  const body = '{"event":"x"}';
  const secret = 'top-secret';

  it('github/jira accept the sha256= scheme', async () => {
    const sig = await sign(body, secret);
    expect(await verifyProviderWebhookSignature('github', body, headerGetter({ 'X-Hub-Signature-256': sig }), secret)).toBe(true);
    expect(await verifyProviderWebhookSignature('jira', body, headerGetter({ 'X-Hub-Signature-256': sig }), secret)).toBe(true);
    expect(await verifyProviderWebhookSignature('github', body, headerGetter({ 'X-Hub-Signature-256': sig }), 'wrong')).toBe(false);
  });

  it('linear verifies a raw-hex Linear-Signature', async () => {
    const sig = await hmacHex(body, secret);
    expect(await verifyProviderWebhookSignature('linear', body, headerGetter({ 'Linear-Signature': sig }), secret)).toBe(true);
    expect(await verifyProviderWebhookSignature('linear', body, headerGetter({ 'Linear-Signature': sig }), 'wrong')).toBe(false);
    expect(await verifyProviderWebhookSignature('linear', body, headerGetter({}), secret)).toBe(false);
  });

  it('sentry verifies Sentry-Hook-Signature', async () => {
    const sig = await hmacHex(body, secret);
    expect(await verifyProviderWebhookSignature('sentry', body, headerGetter({ 'Sentry-Hook-Signature': sig }), secret)).toBe(true);
    expect(await verifyProviderWebhookSignature('sentry', body, headerGetter({ 'Sentry-Hook-Signature': 'deadbeef' }), secret)).toBe(false);
  });

  it('pagerduty accepts any matching v1= signature in the list', async () => {
    const sig = await hmacHex(body, secret);
    const header = `v1=deadbeef,v1=${sig}`;
    expect(await verifyProviderWebhookSignature('pagerduty', body, headerGetter({ 'X-PagerDuty-Signature': header }), secret)).toBe(true);
    expect(await verifyProviderWebhookSignature('pagerduty', body, headerGetter({ 'X-PagerDuty-Signature': 'v1=deadbeef' }), secret)).toBe(false);
  });

  it('monday verifies an HS256 JWT in Authorization', async () => {
    const h = b64url('{"alg":"HS256","typ":"JWT"}');
    const p = b64url('{"foo":"bar"}');
    const good = `${h}.${p}.${await hmacB64Url(`${h}.${p}`, secret)}`;
    expect(await verifyProviderWebhookSignature('monday', body, headerGetter({ Authorization: `Bearer ${good}` }), secret)).toBe(true);
    expect(await verifyProviderWebhookSignature('monday', body, headerGetter({ Authorization: `Bearer ${good}` }), 'wrong')).toBe(false);
    expect(await verifyProviderWebhookSignature('monday', body, headerGetter({ Authorization: 'Bearer not.a.jwt' }), secret)).toBe(false);
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

describe('normalizeWebhookPayload — linear', () => {
  it('normalizes an Issue event', () => {
    const t = normalizeWebhookPayload('linear', {
      type: 'Issue',
      data: { id: 'iss_9', identifier: 'ENG-9', title: 'Crash', description: 'stack', url: 'https://linear.app/x/issue/ENG-9', updatedAt: '2024-05-05T00:00:00Z', state: { name: 'Todo' } },
    });
    expect(t!.externalId).toBe('iss_9');
    expect(t!.state).toBe('Todo');
    expect(t!.externalVersion).toBe('2024-05-05T00:00:00Z');
  });

  it('ignores non-Issue types and missing data', () => {
    expect(normalizeWebhookPayload('linear', { type: 'Comment', data: { id: 'c1' } })).toBeNull();
    expect(normalizeWebhookPayload('linear', { type: 'Issue' })).toBeNull();
  });
});

describe('normalizeWebhookPayload — sentry', () => {
  it('normalizes from data.issue or top-level issue', () => {
    const a = normalizeWebhookPayload('sentry', { data: { issue: { id: '7', title: 'Err', culprit: 'app', permalink: 'https://sentry.io/i/7', status: 'unresolved', lastSeen: '2024-06-06T00:00:00Z' } } });
    expect(a!.externalId).toBe('7');
    expect(a!.body).toBe('app');
    const b = normalizeWebhookPayload('sentry', { issue: { id: '8', title: 'Err2', status: 'resolved' } });
    expect(b!.externalId).toBe('8');
    expect(b!.state).toBe('resolved');
  });

  it('returns null without an issue id', () => {
    expect(normalizeWebhookPayload('sentry', { data: {} })).toBeNull();
  });
});

describe('normalizeWebhookPayload — pagerduty', () => {
  it('normalizes an event.data incident', () => {
    const t = normalizeWebhookPayload('pagerduty', {
      event: { data: { id: 'PINC', title: 'DB down', status: 'triggered', html_url: 'https://pd/PINC', created_at: '2024-07-07T00:00:00Z' } },
    });
    expect(t!.externalId).toBe('PINC');
    expect(t!.state).toBe('triggered');
    expect(t!.title).toBe('DB down');
  });

  it('returns null without an incident id', () => {
    expect(normalizeWebhookPayload('pagerduty', { event: { data: {} } })).toBeNull();
  });
});

describe('normalizeWebhookPayload — monday', () => {
  it('normalizes a pulse event', () => {
    const t = normalizeWebhookPayload('monday', {
      event: { pulseId: 12345, pulseName: 'New item', triggerTime: '2024-08-08T00:00:00Z', value: { label: { text: 'Working' } } },
    });
    expect(t!.externalId).toBe('12345');
    expect(t!.title).toBe('New item');
    expect(t!.state).toBe('Working');
  });

  it('returns null without a pulseId', () => {
    expect(normalizeWebhookPayload('monday', { event: { pulseName: 'x' } })).toBeNull();
  });
});

describe('normalizeWebhookPayload — unknown / no-webhook provider', () => {
  it('returns null for unknown and for poll-only providers (asana/clickup/servicenow)', () => {
    expect(normalizeWebhookPayload('trello', { card: {} })).toBeNull();
    expect(normalizeWebhookPayload('asana', { events: [{}] })).toBeNull();
    expect(normalizeWebhookPayload('clickup', { task_id: 'x' })).toBeNull();
    expect(normalizeWebhookPayload('servicenow', { result: {} })).toBeNull();
  });
});
