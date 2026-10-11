/**
 * FO-B4 — distributing a requisition, and the rule that makes it trustworthy.
 *
 * The claims worth asserting are the module's three decisions, each silent when wrong:
 * a board's answer with no posting id is recorded as a FAILURE (a "live on Indeed" that
 * nobody can find sends candidates nowhere); a board that already confirmed the posting
 * is not called again (a second create is a second posting); and a board the workspace
 * never connected writes no row at all (a `failed` row would read as a publish that
 * went wrong rather than one that was never possible).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import { atsDbStub } from './__fixtures__/atsDbStub';
import { HIRING_CONNECTORS } from '../connectors/defaults/hiring';
import type { ConnectorCallResult } from '../connectors/connectorRuntime';
import type { PostingDistributionView } from './postingDistributionStore';

vi.mock('../connectors/connectorRegistry', async () => {
  const { HIRING_CONNECTORS: boards } = await import('../connectors/defaults/hiring');
  return {
    listPublishedConnectors: vi.fn(async () => boards.map((manifest) => ({
      manifest, origin: 'builtin', id: null, status: 'published', version: 1,
    }))),
  };
});

vi.mock('./postingDistributionStore', () => ({
  readPostingDistributions: vi.fn(async () => new Map()),
  recordPostingDistribution: vi.fn(async () => undefined),
}));

import { readPostingDistributions, recordPostingDistribution } from './postingDistributionStore';
import {
  distributableAction,
  distributePosting,
  postingInputFor,
  publicUrl,
  type DistributeDeps,
} from './distributePosting';
import { AtsError } from './atsError';

const ENV = {} as Env;
const recorded = vi.mocked(recordPostingDistribution);
const existing = vi.mocked(readPostingDistributions);

const POSTING = {
  id: 'posting-a',
  title: 'Senior React Engineer',
  description: 'Build the canvas.',
  requirements: 'React\nTypeScript',
  status: 'open',
  experienceLevel: 'expert',
};

/** The two reads the use case issues itself: the posting, then the connections. */
const db = (posting: Record<string, unknown> | null = POSTING) => atsDbStub({
  rows: [
    posting ? [posting] : [],
    [
      { id: 'conn-lever', connectorKey: 'lever-postings', name: 'Lever' },
      { id: 'conn-indeed', connectorKey: 'indeed-jobs', name: 'Indeed' },
      { id: 'conn-feed', connectorKey: 'job-feed', name: 'Careers feed' },
    ],
  ],
});

const answered = (over: Partial<ConnectorCallResult>): ConnectorCallResult => ({ ok: true, status: 201, data: null, durationMs: 5, ...over });

const deps = (results: Record<string, ConnectorCallResult | Error>): DistributeDeps & { execute: ReturnType<typeof vi.fn> } => ({
  execute: vi.fn(async ({ connectorKey }: { connectorKey: string }) => {
    const result = results[connectorKey];
    if (result instanceof Error) throw result;
    if (!result) throw new Error(`unexpected call to ${connectorKey}`);
    return result;
  }),
}) as DistributeDeps & { execute: ReturnType<typeof vi.fn> };

const posted = (connectorKey: string): PostingDistributionView => ({
  postingId: 'posting-a', connectorKey, board: connectorKey, connectionId: 'conn', externalId: 'ext-1',
  url: null, status: 'posted', postedAt: '2026-10-01T00:00:00.000Z', lastError: null, updatedAt: '2026-10-01T00:00:00.000Z',
  applicantCount: 0,
});

beforeEach(() => {
  recorded.mockClear();
  existing.mockReset();
  existing.mockResolvedValue(new Map());
});

describe('distributePosting', () => {
  it('records a confirmed board as posted with the id and url the board returned', async () => {
    const run = deps({
      'lever-postings': answered({ data: { data: { id: 'lever-9', urls: { show: 'https://jobs.lever.co/acme/lever-9' } } } }),
    });
    const { db: stub } = db();

    const result = await distributePosting(stub, ENV, { tenantId: 7, postingId: 'posting-a', connectorKeys: ['lever-postings'] }, run);

    expect(result.outcomes).toEqual([{
      connectorKey: 'lever-postings', outcome: 'posted', externalId: 'lever-9', url: 'https://jobs.lever.co/acme/lever-9', error: null,
    }]);
    expect(recorded).toHaveBeenCalledWith(stub, expect.objectContaining({
      tenantId: 7, postingId: 'posting-a', connectorKey: 'lever-postings', connectionId: 'conn-lever',
      status: 'posted', externalId: 'lever-9',
    }));
    // Through the one executor, under the board's own connection, carrying the posting
    // id as `external_id` so the board can name it back on every application.
    expect(run.execute).toHaveBeenCalledWith(expect.objectContaining({
      connectorKey: 'lever-postings', actionKey: 'create_posting', connectionId: 'conn-lever',
      input: expect.objectContaining({ title: 'Senior React Engineer', external_id: 'posting-a' }),
    }));
  });

  /** THE rule. A 2xx is not a publication; an id is. */
  it('records a 2xx with no posting id as failed, never as posted', async () => {
    const run = deps({ 'indeed-jobs': answered({ status: 200, data: { data: {} } }) });
    const { db: stub } = db();

    const result = await distributePosting(stub, ENV, { tenantId: 7, postingId: 'posting-a', connectorKeys: ['indeed-jobs'] }, run);

    expect(result.outcomes[0]).toMatchObject({ outcome: 'failed', externalId: null });
    expect(result.outcomes[0]?.error).toMatch(/no posting id/);
    expect(recorded).toHaveBeenCalledWith(stub, expect.objectContaining({ status: 'failed', externalId: null }));
  });

  it('reads a refusal inside a successful body as a failure', async () => {
    const run = deps({ 'indeed-jobs': answered({ status: 200, data: { errors: [{ message: 'Invalid location' }] } }) });
    const { db: stub } = db();
    const result = await distributePosting(stub, ENV, { tenantId: 7, postingId: 'posting-a', connectorKeys: ['indeed-jobs'] }, run);
    expect(result.outcomes[0]).toMatchObject({ outcome: 'failed' });
    expect(result.outcomes[0]?.error).toMatch(/Invalid location/);
  });

  it('records an upstream error and a misconfiguration as failures, and carries on to the next board', async () => {
    const run = deps({
      'indeed-jobs': answered({ ok: false, status: 401, error: 'Unauthorized' }),
      'job-feed': new Error('Connection "Careers feed" is missing: Feed base URL'),
      'lever-postings': answered({ data: { data: { id: 'lever-9' } } }),
    });
    const { db: stub } = db();

    const result = await distributePosting(stub, ENV, {
      tenantId: 7, postingId: 'posting-a', connectorKeys: ['indeed-jobs', 'job-feed', 'lever-postings'],
    }, run);

    expect(result.outcomes.map((o) => o.outcome)).toEqual(['failed', 'failed', 'posted']);
    expect(result.outcomes[1]?.error).toMatch(/missing: Feed base URL/);
    expect(recorded).toHaveBeenCalledTimes(3);
  });

  it('does not call a board that already confirmed the posting', async () => {
    existing.mockResolvedValue(new Map([['posting-a', [posted('lever-postings')]]]));
    const run = deps({});
    const { db: stub } = db();

    const result = await distributePosting(stub, ENV, { tenantId: 7, postingId: 'posting-a', connectorKeys: ['lever-postings'] }, run);

    expect(result.outcomes[0]).toMatchObject({ outcome: 'already-posted', externalId: 'ext-1' });
    expect(run.execute).not.toHaveBeenCalled();
    expect(recorded).not.toHaveBeenCalled();
  });

  it('writes no row for a board the workspace has not connected', async () => {
    const run = deps({});
    const { db: stub } = db();
    const result = await distributePosting(stub, ENV, { tenantId: 7, postingId: 'posting-a', connectorKeys: ['greenhouse-job-board'] }, run);
    expect(result.outcomes[0]).toMatchObject({ outcome: 'unavailable' });
    expect(run.execute).not.toHaveBeenCalled();
    expect(recorded).not.toHaveBeenCalled();
  });

  it('refuses a posting that is not open, and one this workspace does not own', async () => {
    await expect(distributePosting(db({ ...POSTING, status: 'filled' }).db, ENV, {
      tenantId: 7, postingId: 'posting-a', connectorKeys: ['lever-postings'],
    }, deps({}))).rejects.toMatchObject({ name: 'AtsError', status: 409 });

    await expect(distributePosting(db(null).db, ENV, {
      tenantId: 7, postingId: 'posting-gone', connectorKeys: ['lever-postings'],
    }, deps({}))).rejects.toBeInstanceOf(AtsError);
  });

  it('refuses an empty board list before reading anything', async () => {
    await expect(distributePosting(db().db, ENV, { tenantId: 7, postingId: 'posting-a', connectorKeys: [' '] }, deps({})))
      .rejects.toMatchObject({ status: 400 });
  });
});

describe('what a board is sent', () => {
  it('sends the record’s facts and the card’s, and never a salary', () => {
    const input = postingInputFor(POSTING, { location: 'Berlin — hybrid', employmentType: 'permanent', remote: false, applyUrl: 'https://careers.acme.test/jobs/posting-a' });
    expect(input).toEqual({
      title: 'Senior React Engineer',
      description: 'Build the canvas.\n\nReact\nTypeScript',
      external_id: 'posting-a',
      location: 'Berlin — hybrid',
      employment_type: 'permanent',
      seniority: 'expert',
      apply_url: 'https://careers.acme.test/jobs/posting-a',
      remote: false,
    });
    expect(Object.keys(input).some((key) => key.startsWith('salary'))).toBe(false);
  });

  it('leaves out what nobody stated rather than defaulting it', () => {
    const input = postingInputFor({ ...POSTING, description: null, requirements: null, experienceLevel: null });
    expect(input).toEqual({ title: 'Senior React Engineer', description: 'Senior React Engineer', external_id: 'posting-a' });
  });
});

describe('which boards are distributable', () => {
  it('is every hiring board, by the declaration alone', () => {
    expect(HIRING_CONNECTORS.filter((manifest) => distributableAction(manifest)).map((m) => m.key).sort())
      .toEqual(HIRING_CONNECTORS.map((m) => m.key).sort());
  });

  it('is not a board whose create answer names no id, or a non-hiring connector', () => {
    const lever = HIRING_CONNECTORS.find((m) => m.key === 'lever-postings')!;
    const blind = { ...lever, actions: lever.actions.map((a) => (a.key === 'create_posting' ? { ...a, response: { url: ['data.urls.show'] } } : a)) };
    expect(distributableAction(blind)).toBeNull();
    expect(distributableAction({ ...lever, category: 'marketing' })).toBeNull();
  });
});

describe('the board-reported url', () => {
  it('keeps an absolute http(s) address and drops anything a card should not link to', () => {
    expect(publicUrl('https://jobs.lever.co/acme/1')).toBe('https://jobs.lever.co/acme/1');
    expect(publicUrl('javascript:alert(1)')).toBeNull();
    expect(publicUrl('/jobs/1')).toBeNull();
    expect(publicUrl(null)).toBeNull();
  });
});
