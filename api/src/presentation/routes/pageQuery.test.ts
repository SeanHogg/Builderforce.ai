/**
 * `parsePageQuery` — the ONE page-request reader (PRD 47 §8 api):
 * allowlist, 400 on an unknown sort, page-size clamp.
 */
import { describe, expect, it } from 'vitest';
import { integer, pgTable } from 'drizzle-orm/pg-core';
import { ValidationError } from '../../domain/shared/errors';
import { parsePageQuery, type ParsePageQueryOptions } from './pageQuery';

// A real table, so the sort map holds real `PgColumn`s (not bare column builders).
const testTable = pgTable('parse_page_query_test', {
  updatedAt: integer('updated_at'),
  title: integer('title'),
});
const opts: ParsePageQueryOptions = {
  sorts: { updatedAt: testTable.updatedAt, title: testTable.title },
  defaultSort: { key: 'updatedAt', dir: 'desc' },
};

const c = (query: Record<string, string>) =>
  ({ req: { query: (k: string) => query[k] } }) as never;

describe('parsePageQuery', () => {
  it('defaults to page 1, page size 50, the default sort and archived=exclude', () => {
    const r = parsePageQuery(c({}), opts);
    expect(r).toMatchObject({ limit: 50, offset: 0, archived: 'exclude' });
    expect(r.orderBy).toBeDefined();
    expect(r.q).toBeUndefined();
  });

  it('clamps a junk page to 1 and an oversized pageSize to 250', () => {
    const r = parsePageQuery(c({ page: 'abc', pageSize: '999999' }), opts);
    expect(r).toMatchObject({ limit: 250, offset: 0 });
  });

  it('maps page 3 at size 100 to offset 200', () => {
    const r = parsePageQuery(c({ page: '3', pageSize: '100' }), opts);
    expect(r).toMatchObject({ limit: 100, offset: 200 });
  });

  it('rejects a sort key outside the allowlist with a 400 (ValidationError)', () => {
    expect(() => parsePageQuery(c({ sort: 'password_hash' }), opts)).toThrow(ValidationError);
  });

  it('accepts an allowlisted sort key and honours dir', () => {
    const r = parsePageQuery(c({ sort: 'title', dir: 'asc' }), opts);
    expect(r.orderBy).toBeDefined();
  });

  it('coerces a non-asc dir to asc', () => {
    const r = parsePageQuery(c({ dir: 'sideways' }), opts);
    expect(r.orderBy).toBeDefined();
  });

  it('maps archived=only/all and lowercases q', () => {
    expect(parsePageQuery(c({ archived: 'only' }), opts).archived).toBe('only');
    expect(parsePageQuery(c({ archived: 'all' }), opts).archived).toBe('all');
    expect(parsePageQuery(c({ archived: 'bogus' }), opts).archived).toBe('exclude');
    expect(parsePageQuery(c({ q: '  Hello ' }), opts).q).toBe('hello');
  });
});
