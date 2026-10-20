import { describe, expect, it } from 'vitest';
import { redactForQueue } from './syncRedaction.js';

const SECRET = 'super-secret-value-9f3a';

describe('sync redaction', () => {
  it('returns a new empty object for an empty record', () => {
    const record = {};
    const queued = redactForQueue(record);
    expect(queued).toEqual({});
    expect(queued).not.toBe(record);
  });

  it('copies a secret-free record equal in content but not the same reference', () => {
    const record = {
      id: 'e1',
      kind: 'ticket',
      occurredAt: 1_700_000_000_000,
      destinationKey: 'acct/tenant/project',
      body: { title: 'Ship redaction', nested: { note: 'keep me' } },
    };
    const queued = redactForQueue(record);
    expect(queued).toEqual(record);
    expect(queued).not.toBe(record);
    expect(queued.body).not.toBe(record.body);
  });

  it('omits secret-named fields instead of leaving a placeholder that still holds the value', () => {
    const record = {
      id: 'e2',
      kind: 'audit',
      occurredAt: 1_700_000_000_001,
      destinationKey: 'bound',
      accessToken: SECRET,
      password: SECRET,
      apiKey: SECRET,
      authorization: `Bearer ${SECRET}`,
      cookie: `session=${SECRET}`,
      clientSecret: SECRET,
      body: { title: 'visible' },
    };
    const queued = redactForQueue(record);
    expect(queued).toEqual({
      id: 'e2',
      kind: 'audit',
      occurredAt: 1_700_000_000_001,
      destinationKey: 'bound',
      body: { title: 'visible' },
    });
    const encoded = JSON.stringify(queued);
    expect(encoded).not.toContain(SECRET);
    expect(encoded).not.toContain('[REDACTED]');
    expect(encoded).not.toContain('***');
    expect(queued).not.toHaveProperty('accessToken');
    expect(queued).not.toHaveProperty('password');
    expect(queued).not.toHaveProperty('apiKey');
    expect(queued).not.toHaveProperty('authorization');
    expect(queued).not.toHaveProperty('cookie');
    expect(queued).not.toHaveProperty('clientSecret');
  });

  it('drops nested body fields whose names match the secret pattern, at every depth', () => {
    const record = {
      id: 'e3',
      kind: 'run',
      occurredAt: 1_700_000_000_002,
      destinationKey: 'bound',
      body: {
        title: 'keep',
        accessToken: SECRET,
        Password: SECRET,
        APIKEY: SECRET,
        sessionCookie: SECRET,
        Authorization: `Bearer ${SECRET}`,
        clientSecret: SECRET,
        nested: {
          note: 'also keep',
          refreshToken: SECRET,
          items: [{ name: 'row', apiKey: SECRET, tokenCount: 3 }],
        },
      },
    };
    const queued = redactForQueue(record);
    expect(queued).toEqual({
      id: 'e3',
      kind: 'run',
      occurredAt: 1_700_000_000_002,
      destinationKey: 'bound',
      body: {
        title: 'keep',
        nested: {
          note: 'also keep',
          items: [{ name: 'row' }],
        },
      },
    });
    expect(JSON.stringify(queued)).not.toContain(SECRET);
    expect(JSON.stringify(queued)).not.toContain('[REDACTED]');
  });

  it('does not mutate the input, including nested body objects', () => {
    const record = {
      id: 'e4',
      kind: 'chat',
      occurredAt: 1_700_000_000_003,
      destinationKey: 'bound',
      password: SECRET,
      body: { title: 'keep', apiKey: SECRET, nested: { cookie: SECRET, note: 'stay' } },
    };
    const before = JSON.parse(JSON.stringify(record)) as typeof record;
    redactForQueue(record);
    expect(record).toEqual(before);
    expect(record.password).toBe(SECRET);
    expect(record.body.apiKey).toBe(SECRET);
    expect(record.body.nested.cookie).toBe(SECRET);
  });

  it('does not copy non-queue fields, secret or not', () => {
    const record = {
      id: 'e5',
      note: 'not a queue field',
      body: { title: 'keep' },
    };
    expect(redactForQueue(record)).toEqual({ id: 'e5', body: { title: 'keep' } });
  });

  it('returns an empty object for a non-object record', () => {
    expect(redactForQueue(null)).toEqual({});
    expect(redactForQueue(undefined)).toEqual({});
    expect(redactForQueue('password')).toEqual({});
    expect(redactForQueue(['apiKey'])).toEqual({});
  });
});
