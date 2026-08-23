import { describe, expect, it } from 'vitest';
import { parseStatement, type XapiStatement } from '../../domain/learning/xapiStatement';
import { sha256Hex } from '../../infrastructure/crypto/digest';
import {
  COURSE_ACTIVITY_BASE, XAPI_EVENT_PREFIX, XAPI_TARGET_TYPE,
  courseActivityIri, toActivityInput, verbFor,
} from './lrsStatements';

const NOW = new Date('2026-03-01T12:00:00.000Z');
const ID = '11111111-2222-4333-8444-555555555555';

function build(patch: Record<string, unknown> = {}): XapiStatement {
  const parsed = parseStatement({
    id: ID,
    actor: { name: 'Ada Lovelace', mbox: 'mailto:ada@example.com' },
    verb: { id: 'http://adlnet.gov/expapi/verbs/completed' },
    object: { id: courseActivityIri(7), definition: { name: { 'en-US': 'Analytical Engines' } } },
    ...patch,
  }, { now: NOW, newId: () => ID });
  if (!parsed.ok) throw new Error(`fixture did not parse: ${JSON.stringify(parsed.problems)}`);
  return parsed.statement;
}

describe('verbFor', () => {
  it('keeps the last path segment, which is where an IRI carries its meaning', () => {
    expect(verbFor('http://adlnet.gov/expapi/verbs/completed')).toBe('xapi.completed');
  });

  it('handles a fragment IRI as well as a path one', () => {
    expect(verbFor('https://w3id.org/xapi/dod-isd/verbs#answered')).toBe('xapi.answered');
  });

  it('never exceeds the column, whatever a custom vocabulary does', () => {
    const long = `https://vendor.example/verbs/${'x'.repeat(200)}`;
    expect(verbFor(long).length).toBeLessThanOrEqual(64);
  });

  it('falls back rather than producing a bare prefix when there is no segment at all', () => {
    expect(verbFor('///')).toBe('xapi.experienced');
    // A degenerate IRI with no separator still yields something greppable rather
    // than the fallback, which would silently claim a verb nobody sent.
    expect(verbFor('urn:')).toBe('xapi.urn:');
  });
});

describe('courseActivityIri', () => {
  it('is the base plus the id, in one place, used in both directions', () => {
    expect(courseActivityIri(7)).toBe(`${COURSE_ACTIVITY_BASE}7`);
  });
});

describe('toActivityInput', () => {
  it('stores the statement id as a namespaced event key — the UNIQUE index is the immutability rule', async () => {
    const input = await toActivityInput(3, build());
    expect(input.eventKey).toBe(`${XAPI_EVENT_PREFIX}${ID}`);
    expect(input.tenantId).toBe(3);
  });

  it('hashes the actor key and the activity IRI to fixed-width, indexable columns', async () => {
    const input = await toActivityInput(3, build());
    expect(input.actor.ref).toBe(await sha256Hex('mbox:ada@example.com'));
    expect(input.targetId).toBe(await sha256Hex(courseActivityIri(7)));
    expect(input.actor.ref).toHaveLength(64);
  });

  it('keeps the ORIGINALS beside the hashes, which is what lets a GET answer', async () => {
    const input = await toActivityInput(3, build());
    const metadata = input.metadata as Record<string, unknown>;
    expect(input.targetLabel).toBe(courseActivityIri(7));
    expect(metadata.agent).toBe('mbox:ada@example.com');
    expect(metadata.activityId).toBe(courseActivityIri(7));
    expect(metadata.statementId).toBe(ID);
  });

  it('files the statement under the learner actor type and the xAPI target type', async () => {
    const input = await toActivityInput(3, build());
    expect(input.actor.type).toBe('learner');
    expect(input.targetType).toBe(XAPI_TARGET_TYPE);
    expect(input.actor.name).toBe('Ada Lovelace');
  });

  it('names an anonymous learner rather than leaving the column empty', async () => {
    const input = await toActivityInput(3, build({ actor: { mbox: 'mailto:ada@example.com' } }));
    expect(input.actor.name).toBe('Learner');
  });

  it('keeps the FULL verb IRI in metadata while the column carries the short form', async () => {
    const input = await toActivityInput(3, build());
    expect(input.verb).toBe('xapi.completed');
    expect((input.metadata as Record<string, unknown>).verbId)
      .toBe('http://adlnet.gov/expapi/verbs/completed');
  });

  it('carries the resolved object id when the IRI is one of ours, and null when it is not', async () => {
    expect((await toActivityInput(3, build(), 'obj_123')).objectId).toBe('obj_123');
    // A third party's IRI is stored verbatim and simply has no local object.
    const foreign = build({ object: { id: 'https://someone-else.example/activity/9' } });
    expect((await toActivityInput(3, foreign)).objectId).toBeNull();
  });

  it('carries the exact document that arrived, so a GET returns what was PUT', async () => {
    const input = await toActivityInput(3, build());
    const metadata = input.metadata as Record<string, unknown>;
    expect((metadata.statement as Record<string, unknown>).id).toBe(ID);
  });

  it('uses the statement timestamp as the occurrence, not the store time', async () => {
    const input = await toActivityInput(3, build({ timestamp: '2026-01-05T08:30:00.000Z' }));
    expect(input.occurredAt?.toISOString()).toBe('2026-01-05T08:30:00.000Z');
  });
});
