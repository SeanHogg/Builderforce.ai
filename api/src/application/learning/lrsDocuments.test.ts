import { describe, expect, it } from 'vitest';
import {
  addressFor, checkPrecondition, etagFor, isJsonType, normaliseEtag,
} from './lrsDocuments';

describe('addressFor', () => {
  it('builds a full State address', () => {
    const built = addressFor({
      scope: 'state', activityId: 'https://a.example/1', agentKey: 'mbox:ada@example.com',
      registration: 'reg-1', documentId: 'bookmark',
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.address).toEqual({
      scope: 'state', activityId: 'https://a.example/1', agentKey: 'mbox:ada@example.com',
      registration: 'reg-1', documentId: 'bookmark',
    });
  });

  it('CLEARS the dimension a scope does not use, rather than storing it', () => {
    // An Activity Profile that kept the agent it happened to be written by would
    // be a different document per learner — which is exactly what it is not.
    const profile = addressFor({
      scope: 'activity_profile', activityId: 'https://a.example/1',
      agentKey: 'mbox:ada@example.com', registration: 'reg-1', documentId: 'meta',
    });
    expect(profile.ok && profile.address.agentKey).toBe('');
    expect(profile.ok && profile.address.registration).toBe('');

    const agent = addressFor({
      scope: 'agent_profile', activityId: 'https://a.example/1',
      agentKey: 'mbox:ada@example.com', documentId: 'prefs',
    });
    expect(agent.ok && agent.address.activityId).toBe('');
  });

  it('never produces a null — the unique index cannot compare two of those', () => {
    const built = addressFor({ scope: 'agent_profile', agentKey: 'mbox:a@b.com', documentId: 'p' });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(Object.values(built.address).every((v) => typeof v === 'string')).toBe(true);
  });

  it('refuses an address that identifies nothing', () => {
    expect(addressFor({ scope: 'state', activityId: 'https://a', agentKey: 'mbox:a@b.com' }))
      .toMatchObject({ ok: false, status: 400 });
    expect(addressFor({ scope: 'state', agentKey: 'mbox:a@b.com', documentId: 'd' }))
      .toMatchObject({ ok: false, status: 400 });
    expect(addressFor({ scope: 'agent_profile', documentId: 'd' }))
      .toMatchObject({ ok: false, status: 400 });
  });

  it('does not require an agent for an Activity Profile, nor an activity for an Agent Profile', () => {
    expect(addressFor({ scope: 'activity_profile', activityId: 'https://a', documentId: 'd' }).ok).toBe(true);
    expect(addressFor({ scope: 'agent_profile', agentKey: 'mbox:a@b.com', documentId: 'd' }).ok).toBe(true);
  });
});

describe('checkPrecondition', () => {
  const existing = { etag: 'abc123' };

  it('REFUSES a blind overwrite of an existing document with 409', () => {
    // The rule that is easy to miss and impossible to notice: the specification
    // says a PUT over an existing document with no precondition is a conflict,
    // because the client cannot know what it is overwriting.
    expect(checkPrecondition(existing, {})).toMatchObject({ ok: false, status: 409 });
  });

  it('allows a first write with no precondition', () => {
    expect(checkPrecondition(null, {})).toEqual({ ok: true });
  });

  it('honours If-Match against the current tag, and refuses a stale one', () => {
    expect(checkPrecondition(existing, { ifMatch: '"abc123"' })).toEqual({ ok: true });
    expect(checkPrecondition(existing, { ifMatch: '"older"' })).toMatchObject({ ok: false, status: 412 });
  });

  it('fails If-Match when there is nothing to match', () => {
    expect(checkPrecondition(null, { ifMatch: '"abc123"' })).toMatchObject({ ok: false, status: 412 });
  });

  it('treats If-None-Match: * as create-only', () => {
    expect(checkPrecondition(null, { ifNoneMatch: '*' })).toEqual({ ok: true });
    expect(checkPrecondition(existing, { ifNoneMatch: '*' })).toMatchObject({ ok: false, status: 412 });
  });

  it('refuses a write whose If-None-Match names the tag that is already there', () => {
    expect(checkPrecondition(existing, { ifNoneMatch: '"abc123"' })).toMatchObject({ ok: false, status: 412 });
    expect(checkPrecondition(existing, { ifNoneMatch: '"other"' })).toEqual({ ok: true });
  });

  it('lets If-Match win when both headers arrive', () => {
    expect(checkPrecondition(existing, { ifMatch: '"abc123"', ifNoneMatch: '"abc123"' })).toEqual({ ok: true });
  });
});

describe('normaliseEtag', () => {
  it('reads quoted, weak and bare forms as the same tag', () => {
    expect(normaliseEtag('"abc"')).toBe('abc');
    expect(normaliseEtag('W/"abc"')).toBe('abc');
    expect(normaliseEtag('abc')).toBe('abc');
  });

  it('is null for nothing at all', () => {
    expect(normaliseEtag('')).toBeNull();
    expect(normaliseEtag(null)).toBeNull();
    expect(normaliseEtag('""')).toBeNull();
  });
});

describe('etagFor', () => {
  it('is a function of the bytes, so identical documents agree', async () => {
    expect(await etagFor({ a: 1 })).toBe(await etagFor({ a: 1 }));
    expect(await etagFor({ a: 1 })).not.toBe(await etagFor({ a: 2 }));
  });

  it('is defined for an empty document', async () => {
    expect(await etagFor(null)).toHaveLength(64);
  });
});

describe('isJsonType', () => {
  it('accepts the +json family, which is how real authoring tools label state', () => {
    expect(isJsonType('application/json')).toBe(true);
    expect(isJsonType('application/vnd.example+json')).toBe(true);
    expect(isJsonType('text/plain')).toBe(false);
  });
});
