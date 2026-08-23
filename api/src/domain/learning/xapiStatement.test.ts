import { describe, expect, it } from 'vitest';
import { actorKey, parseAgent, parseStatement, type XapiActor } from './xapiStatement';

const NOW = new Date('2026-03-01T12:00:00.000Z');
const ID = '11111111-2222-4333-8444-555555555555';
const context = { now: NOW, newId: () => ID };

const statement = (patch: Record<string, unknown> = {}) => ({
  actor: { mbox: 'mailto:Ada@Example.com' },
  verb: { id: 'http://adlnet.gov/expapi/verbs/completed' },
  object: { id: 'https://builderforce.ai/xapi/activities/course/7' },
  ...patch,
});

describe('parseStatement — the actor identifier', () => {
  it('accepts exactly one inverse-functional identifier', () => {
    const parsed = parseStatement(statement(), context);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.statement.actor.identifier).toEqual({ kind: 'mbox', value: 'ada@example.com' });
  });

  it('refuses TWO identifiers rather than picking one', () => {
    // Two identifiers is an authoring tool that has confused two people, and
    // choosing between them is how the wrong learner gets the certificate.
    const parsed = parseStatement(
      statement({ actor: { mbox: 'mailto:a@b.com', openid: 'https://id.example/ada' } }),
      context,
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problems.some((p) => p.field === 'actor')).toBe(true);
  });

  it('refuses an actor with none', () => {
    const parsed = parseStatement(statement({ actor: { name: 'Ada' } }), context);
    expect(parsed.ok).toBe(false);
  });

  it('ignores an identifier that is present but malformed', () => {
    // `mbox` without `mailto:` does not count, so this actor has zero valid
    // identifiers rather than one bad one.
    const parsed = parseStatement(statement({ actor: { mbox: 'ada@example.com' } }), context);
    expect(parsed.ok).toBe(false);
  });
});

describe('actorKey', () => {
  const key = (identifier: XapiActor['identifier']) =>
    actorKey({ objectType: 'Agent', name: null, identifier });

  it('folds case and the mailto: scheme, so one person is one timeline', () => {
    const upper = parseStatement(statement({ actor: { mbox: 'MAILTO:ADA@EXAMPLE.COM' } }), context);
    const lower = parseStatement(statement({ actor: { mbox: 'mailto:ada@example.com' } }), context);
    expect(upper.ok && lower.ok).toBe(true);
    if (!upper.ok || !lower.ok) return;
    expect(actorKey(upper.statement.actor)).toBe(actorKey(lower.statement.actor));
  });

  it('namespaces by identifier kind, so an openid cannot collide with an mbox', () => {
    expect(key({ kind: 'mbox', value: 'a@b.com' }))
      .not.toBe(key({ kind: 'openid', value: 'a@b.com' }));
  });

  it('joins an account homePage and name, which are jointly unique', () => {
    expect(key({ kind: 'account', value: 'https://lms.example|ada' }))
      .toBe('account:https://lms.example|ada');
  });
});

describe('parseStatement — the rest of the shape', () => {
  it('stamps the LRS clock when no timestamp arrived', () => {
    const parsed = parseStatement(statement(), context);
    expect(parsed.ok && parsed.statement.timestamp.toISOString()).toBe(NOW.toISOString());
  });

  it('mints an id when none arrived, and refuses one that is not a uuid', () => {
    const minted = parseStatement(statement(), context);
    expect(minted.ok && minted.statement.id).toBe(ID);
    expect(parseStatement(statement({ id: 'not-a-uuid' }), context).ok).toBe(false);
  });

  it('refuses a verb or an object that is not an IRI', () => {
    expect(parseStatement(statement({ verb: { id: 'completed' } }), context).ok).toBe(false);
    expect(parseStatement(statement({ object: { id: 'course-7' } }), context).ok).toBe(false);
  });

  it('drops a scaled score outside -1..1 rather than clamping it', () => {
    // Clamping 7 to 1 invents a perfect score nobody achieved.
    const parsed = parseStatement(statement({ result: { score: { scaled: 7 } } }), context);
    expect(parsed.ok && parsed.statement.result?.scaled).toBeNull();
  });

  it('keeps the document that arrived, so a GET can return what was PUT', () => {
    const parsed = parseStatement(statement({ extra: { vendor: 'anything' } }), context);
    expect(parsed.ok && parsed.statement.raw.extra).toEqual({ vendor: 'anything' });
  });

  it('only honours a registration that is a uuid', () => {
    const good = parseStatement(statement({ context: { registration: ID } }), context);
    const bad = parseStatement(statement({ context: { registration: 'session-4' } }), context);
    expect(good.ok && good.statement.registration).toBe(ID);
    expect(bad.ok && bad.statement.registration).toBeNull();
  });
});

describe('parseAgent', () => {
  it('reads the JSON-encoded form the query parameter actually travels in', () => {
    const actor = parseAgent(JSON.stringify({ mbox: 'mailto:ada@example.com' }));
    expect(actor && actorKey(actor)).toBe('mbox:ada@example.com');
  });

  it('reads the object form too, and agrees with the string one', () => {
    const fromObject = parseAgent({ mbox: 'mailto:ada@example.com' });
    const fromString = parseAgent('{"mbox":"mailto:ada@example.com"}');
    expect(fromObject && fromString && actorKey(fromObject)).toBe(actorKey(fromString!));
  });

  it('returns null for anything that is not one identified agent', () => {
    expect(parseAgent('not json')).toBeNull();
    expect(parseAgent({ name: 'Ada' })).toBeNull();
    expect(parseAgent(undefined)).toBeNull();
  });
});
