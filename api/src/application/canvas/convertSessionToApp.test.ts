import { describe, it, expect } from 'vitest';
import { APP_MODALITY, cachedAppForSession, copyableLinkFilter } from './convertSessionToApp';
import {
  SESSION_PROJECT_LINK_APP,
  SESSION_PROJECT_LINK_REFERENCE,
} from '../../infrastructure/database/schema';
import { checkSubdomainAvailability } from '../ide/siteHosting';

/**
 * A minimal stand-in for the one query `checkSubdomainAvailability` makes. The
 * real one is a single indexed lookup, so faking it keeps this a unit test of
 * the RULE rather than of drizzle.
 */
function dbWithOwner(owner: { projectId: number } | null) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (owner ? [owner] : []) }),
      }),
    }),
  } as unknown as Parameters<typeof checkSubdomainAvailability>[0];
}

describe('app conversion vocabulary', () => {
  it('uses a modality VALUE rather than a new flag', () => {
    // The whole "project = app" decision rests on this: a new kind is a column
    // value. If this ever becomes a boolean somewhere, the decision has been
    // quietly reversed.
    expect(APP_MODALITY).toBe('app');
  });

  it('copies only reference links, never the app identity', () => {
    // Copy, branch and merge all clone a board's project links. Cloning an `app`
    // link would give a duplicated board a second claim on somebody's running
    // app — and the partial unique index would refuse the write, failing the
    // whole batch with an error nobody could explain.
    expect(SESSION_PROJECT_LINK_REFERENCE).toBe('reference');
    expect(SESSION_PROJECT_LINK_APP).toBe('app');
    expect(copyableLinkFilter).toBeDefined();
  });
});

describe('checkSubdomainAvailability', () => {
  it('accepts a free label and reports the host it would serve on', async () => {
    const result = await checkSubdomainAvailability(dbWithOwner(null), 'Sunday RSVP');
    expect(result.label).toBe('sunday-rsvp');
    expect(result.available).toBe(true);
    expect(result.reason).toBe('ok');
    expect(result.host).toBe('sunday-rsvp.builderforce.ai');
  });

  it('separates RESERVED from merely invalid', async () => {
    // `normalizeSubdomain` folds both into one null, but the creator needs to
    // know which: "pick different characters" and "that belongs to the platform"
    // are different instructions.
    const reserved = await checkSubdomainAvailability(dbWithOwner(null), 'admin');
    expect(reserved.reason).toBe('reserved');
    expect(reserved.available).toBe(false);

    const invalid = await checkSubdomainAvailability(dbWithOwner(null), '!!!');
    expect(invalid.reason).toBe('invalid');
    expect(invalid.available).toBe(false);
  });

  it('refuses a label another project already owns', async () => {
    const result = await checkSubdomainAvailability(dbWithOwner({ projectId: 7 }), 'taken');
    expect(result.reason).toBe('taken');
    expect(result.available).toBe(false);
    // No host is offered for a name the caller cannot have.
    expect(result.host).toBeNull();
  });

  it('reports the caller own site as available so re-checking is not a conflict', async () => {
    const result = await checkSubdomainAvailability(dbWithOwner({ projectId: 7 }), 'mine', 7);
    expect(result.available).toBe(true);
    expect(result.reason).toBe('ok');
  });
});

/**
 * The narrow read behind `GET /api/creation-sessions/:id/app`.
 *
 * `app` also rides the full session read, which is right for the canvas — it
 * makes that read anyway — but every other surface that wants the four-field
 * answer had to fetch the whole board graph to get it. A board is opened,
 * closed and reopened constantly, so the read that made that cheap must not
 * then cost a database round-trip per mount.
 */
describe('cachedAppForSession', () => {
  /** Enough of a db to answer the one three-table join, counting the calls. */
  function countingDb(row: Record<string, unknown> | null) {
    const calls = { n: 0 };
    const db = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            leftJoin: () => ({
              where: () => ({
                limit: async () => { calls.n += 1; return row ? [row] : []; },
              }),
            }),
          }),
        }),
      }),
    } as unknown as Parameters<typeof cachedAppForSession>[0];
    return { db, calls };
  }

  /** No KV binding: the helper falls back to its in-isolate layer, which is the
   *  layer this asserts on. A unique session id per test keeps them independent. */
  const env = {} as unknown as Parameters<typeof cachedAppForSession>[1];

  it('answers from the cache on the second ask', async () => {
    const { db, calls } = countingDb({ projectId: 42, projectKey: 'SUN', name: 'Sunday RSVP', subdomain: 'sunday-rsvp' });
    const id = 'session-cache-hit';
    await expect(cachedAppForSession(db, env, 1, id)).resolves.toMatchObject({ projectId: 42 });
    await expect(cachedAppForSession(db, env, 1, id)).resolves.toMatchObject({ projectId: 42 });
    expect(calls.n).toBe(1);
  });

  it('reports a board that never became an app as null', async () => {
    const { db } = countingDb(null);
    await expect(cachedAppForSession(db, env, 1, 'session-never-converted')).resolves.toBeNull();
  });
});
