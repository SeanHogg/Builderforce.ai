/**
 * The generic entity service's REFUSALS (PRD 20 §5 step 5).
 *
 * One service reaches 244 tables, so its guard rails are the only thing between
 * a seat's surface and every row in the schema. Each test below drives a path
 * that must fail BEFORE the database is touched — and proves it by handing in a
 * database that throws if anything reaches it. A refusal that happens after the
 * query is not a refusal.
 */
import { describe, expect, it } from 'vitest';
import {
  EntityError,
  createRow,
  describeScope,
  getRow,
  listRows,
  requireEntity,
  updateRow,
} from './EntityService';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/** A database that fails the test if a refusal path reaches it. */
const noDb = new Proxy(
  {},
  {
    get() {
      throw new Error('the database was touched on a path that must refuse first');
    },
  },
) as unknown as Db;

const env = {} as Env;
const TENANT = 7;

const expectReject = async (run: () => Promise<unknown>, status: number, match: RegExp) => {
  await expect(run()).rejects.toMatchObject({ status, message: expect.stringMatching(match) });
};

describe('scope description', () => {
  it('reports each entity’s shape without a database', () => {
    const hiring = describeScope('hiring');
    const applications = hiring.find((e) => e.name === 'job_applications');
    expect(applications).toBeDefined();
    expect(applications?.kind).toBe('application');
    expect(applications?.writable).toBe(true);
    expect(applications?.fields.some((f) => f.name === 'tenant_id' && f.writable)).toBe(false);
  });

  it('names withheld columns instead of pretending the table is narrower', () => {
    const kernel = describeScope('kernel');
    const credentials = kernel.find((e) => e.name === 'credentials');
    expect(credentials?.redactedFields.length).toBeGreaterThan(0);
    expect(credentials?.fields.some((f) => /secret|ciphertext/.test(f.name))).toBe(false);
  });
});

describe('resolution', () => {
  it('404s an unknown entity', () => {
    expect(() => requireEntity('hiring', 'no_such_table')).toThrow(EntityError);
  });

  it('404s a real table asked for through the wrong seat', () => {
    expect(() => requireEntity('finance', 'job_applications')).toThrow(/unknown entity/);
  });
});

describe('read refusals', () => {
  it('refuses to list a store scoped narrower than a tenant', async () => {
    // `email_otp_challenges` has no tenant column, so there is no predicate that
    // makes a generic list safe — one-time codes against email addresses.
    await expectReject(
      () => listRows(noDb, env, TENANT, requireEntity('identity', 'email_otp_challenges')),
      403,
      /narrower than a tenant/,
    );
    await expectReject(
      () => getRow(noDb, env, TENANT, requireEntity('identity', 'email_otp_challenges'), '1'),
      403,
      /narrower than a tenant/,
    );
  });
});

describe('write refusals', () => {
  it('refuses a write to a read-only entity', async () => {
    await expectReject(
      () => createRow(noDb, env, TENANT, requireEntity('kernel', 'ledger_entries'), { amount: 1 }),
      403,
      /read-only/,
    );
  });

  it('refuses an unknown field rather than dropping it', async () => {
    await expectReject(
      () => createRow(noDb, env, TENANT, requireEntity('hiring', 'job_applications'), { nonsense: 'x' }),
      400,
      /unknown field/,
    );
  });

  it('refuses to let a caller set tenancy or identity', async () => {
    await expectReject(
      () =>
        createRow(noDb, env, TENANT, requireEntity('hiring', 'job_applications'), {
          candidate_ref: 'c1',
          tenant_id: 99,
        }),
      403,
      /not writable/,
    );
  });

  it('refuses a withheld column by name, so a caller is not left guessing', async () => {
    // `invitations.token_hash` exists and is redacted. Reporting it as UNKNOWN
    // would send a caller looking for a column the schema really does have.
    await expectReject(
      () => createRow(noDb, env, TENANT, requireEntity('kernel', 'invitations'), { token_hash: 'x' }),
      403,
      /not writable/,
    );
  });

  it('refuses a create that omits a required column', async () => {
    await expectReject(
      () => createRow(noDb, env, TENANT, requireEntity('hiring', 'job_applications'), { source: 'direct' }),
      400,
      /missing required field/,
    );
  });

  it('refuses a value the column cannot hold', async () => {
    await expectReject(
      () =>
        createRow(noDb, env, TENANT, requireEntity('hiring', 'job_applications'), {
          candidate_ref: 'c1',
          /*
           * A DATE column, because this entity no longer has a writable numeric one.
           *
           * The case used to probe `job_posting_id`, which migration 0983 deliberately
           * WIDENED from integer to varchar(36) so an application could finally name the
           * posting it was an application to — after which 'not-a-number' was a perfectly
           * legal value and this was asserting a refusal the column no longer owes.
           * `score` is not the replacement either: drizzle surfaces `numeric` as a STRING
           * (it refuses to lose precision through a float), so it never reaches the
           * number branch. `applied_at` exercises the same `coerce` switch on a column
           * whose type genuinely rejects the value.
           */
          applied_at: 'not-a-date',
        }),
      400,
      /must be a date/,
    );
  });

  /**
   * A `numeric` column is a STRING to Drizzle (it will not round-trip a decimal through
   * a float) so it never reaches the `number` branch of `coerce`. It is still a number to
   * Postgres, and without an explicit check `'not-a-number'` travelled to the driver and
   * came back as a 500 with a syntax error — from the one layer whose whole promise is
   * to refuse before it touches the database.
   */
  it('refuses a non-numeric value for a numeric (decimal) column', async () => {
    await expectReject(
      () =>
        createRow(noDb, env, TENANT, requireEntity('hiring', 'job_applications'), {
          candidate_ref: 'c1',
          score: 'not-a-number',
        }),
      400,
      /must be a number/,
    );
  });

  it('refuses an update with nothing writable in it', async () => {
    await expectReject(
      () => updateRow(noDb, env, TENANT, requireEntity('hiring', 'job_applications'), '1', {}),
      400,
      /no writable field/,
    );
  });

  it('refuses an empty create', async () => {
    await expectReject(
      () => createRow(noDb, env, TENANT, requireEntity('kernel', 'settings'), {}),
      400,
      /missing required field|empty body/,
    );
  });
});
