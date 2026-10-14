/**
 * THE filter compiler: every field compiles to parameterised SQL (values are bound,
 * never in the SQL text), every rejection carries a reason, and a smart-event rule
 * compiles to the same equals / prefix / contains test the contract's
 * `markMatchesRule` runs in TypeScript (the parity block evaluates the generated
 * LIKE pattern with Postgres' LIKE semantics and compares against the TS matcher).
 */
import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  FILTER_FIELDS,
  markMatchesRule,
  type ReplayFilterClause,
  type SmartEventMark,
  type SmartEventRule,
} from '@builderforce/interaction-contract';
import {
  compileReplayFilter,
  escapeLike,
  filterNeedsSiteRules,
  ruleTextPredicate,
  smartEventPredicate,
  type TextPredicate,
} from './replayFilterCompiler';

const dialect = new PgDialect();
const render = (filter: { all: ReplayFilterClause[] }, siteRules: SmartEventRule[] = []) => {
  const out = compileReplayFilter(filter, { siteRules });
  return { ...out, query: out.where ? dialect.sqlToQuery(out.where) : null };
};

/** A sample clause for every registered field, using its first op. */
function sampleClause(id: string): ReplayFilterClause {
  const spec = FILTER_FIELDS.find((f) => f.id === id)!;
  const op = spec.ops[0]!;
  const scalar = spec.valueKind === 'number' ? 5_000
    : spec.valueKind === 'boolean' ? true
      : spec.valueKind === 'enum' ? spec.values![0]!
        : spec.valueKind === 'keyValue' ? 'plan=pro'
          : `v-${id}`;
  return { field: spec.id, op, value: op === 'in' ? [String(scalar)] : scalar } as ReplayFilterClause;
}

describe('compileReplayFilter', () => {
  it('compiles a sample clause of EVERY registered field, with its value bound as a parameter', () => {
    for (const spec of FILTER_FIELDS) {
      const clause = sampleClause(spec.id);
      const { rejected, query } = render({ all: [clause] });
      expect(rejected, spec.id).toEqual([]);
      expect(query, spec.id).not.toBeNull();
      if (typeof clause.value === 'string' && spec.valueKind !== 'keyValue') {
        expect(query!.sql, spec.id).not.toContain(clause.value);
      }
    }
  });

  it('is undefined for the empty filter', () => {
    expect(compileReplayFilter({ all: [] }).where).toBeUndefined();
    expect(compileReplayFilter(null).where).toBeUndefined();
  });

  it('never splices a hostile value into SQL text', () => {
    const evil = "x'); drop table replay_recordings; --";
    const { query } = render({
      all: [
        { field: 'browser', op: 'eq', value: evil },
        { field: 'visitedPath', op: 'contains', value: evil },
        { field: 'tag', op: 'eq', value: `k=${evil}` },
        { field: 'smartEvent', op: 'eq', value: evil },
      ],
    });
    expect(query!.sql).not.toContain('drop table');
    expect(query!.params).toEqual(expect.arrayContaining([evil, `%${escapeLike(evil.toLowerCase())}%`, 'k']));
  });

  it('uses @> / && with an array parameter for array fields and ->> for tags', () => {
    const { query } = render({
      all: [
        { field: 'frustration', op: 'in', value: ['rage', 'dead'] },
        { field: 'issue', op: 'eq', value: 'abc123' },
        { field: 'tag', op: 'neq', value: 'plan=pro' },
      ],
    });
    expect(query!.sql).toContain('"replay_recordings"."frustrations" &&');
    expect(query!.sql).toContain('"replay_recordings"."issue_fps" @>');
    expect(query!.sql).toMatch(/"replay_recordings"\."tags" ->> \$\d+\) is distinct from \$\d+/);
    // Drizzle encodes a text[] parameter as a Postgres array literal.
    expect(query!.params).toEqual(expect.arrayContaining(['{"rage","dead"}', '{"abc123"}', 'plan', 'pro']));
  });

  it('escapes LIKE metacharacters in contains / prefix', () => {
    const { query } = render({ all: [{ field: 'entryPath', op: 'prefix', value: '/50%_off' }] });
    expect(query!.sql).toContain("escape '\\'");
    expect(query!.params).toContain('/50\\%\\_off%');
  });

  it('rejects, with a reason, a clause it cannot express', () => {
    const out = compileReplayFilter({ all: [{ field: 'durationMs', op: 'contains', value: 5 } as ReplayFilterClause] });
    expect(out.where).toBeUndefined();
    expect(out.rejected).toEqual([{ clause: expect.objectContaining({ field: 'durationMs' }), reason: 'durationMs does not support contains' }]);
  });

  it('resolves a built-in smart event to the stored events array and a site rule to its array predicate', () => {
    const builtin = dialect.sqlToQuery(smartEventPredicate('purchase', { siteRules: [] }));
    expect(builtin.sql).toContain('"replay_recordings"."events" @>');
    expect(builtin.params).toEqual(['{"purchase"}']);

    const rules: SmartEventRule[] = [
      { name: 'pricing', ruleKind: 'page', match: '/Pricing', matchMode: 'prefix' },
      { name: 'pricing', ruleKind: 'click', match: 'plan', matchMode: 'contains' },
    ];
    const site = dialect.sqlToQuery(smartEventPredicate('pricing', { siteRules: rules }));
    expect(site.sql).toContain('unnest("replay_recordings"."routes")');
    expect(site.sql).toContain('unnest("replay_recordings"."clicked")');
    expect(site.params).toEqual(expect.arrayContaining(['{"pricing"}', '/pricing%', '%plan%']));
    expect(filterNeedsSiteRules({ all: [{ field: 'smartEvent', op: 'eq', value: 'pricing' }] })).toBe(true);
    expect(filterNeedsSiteRules({ all: [{ field: 'device', op: 'eq', value: 'phone' }] })).toBe(false);
  });
});

/** Postgres LIKE with `ESCAPE '\'` — `%` any run, `_` one char, `\x` literal x. */
function sqlLike(text: string, pattern: string): boolean {
  let re = '^';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '\\' && i + 1 < pattern.length) re += pattern[++i]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    else if (ch === '%') re += '[\\s\\S]*';
    else if (ch === '_') re += '[\\s\\S]';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${re}$`).test(text);
}

/** What the compiled predicate answers for one text: `lower(text) = p` or `lower(text) LIKE p`. */
function sqlAnswers(text: string, predicate: TextPredicate | null): boolean {
  if (!predicate) return false;
  return predicate.op === 'eq' ? text.toLowerCase() === predicate.pattern : sqlLike(text.toLowerCase(), predicate.pattern);
}

describe('parity: the compiled rule predicate and markMatchesRule agree', () => {
  const rules: SmartEventRule[] = [
    { name: 'a', ruleKind: 'page', match: '/checkout', matchMode: 'prefix' },
    { name: 'b', ruleKind: 'page', match: '/Thank-You', matchMode: 'equals' },
    { name: 'c', ruleKind: 'custom', match: 'Signup_Done', matchMode: 'equals' },
    { name: 'd', ruleKind: 'custom', match: '50%', matchMode: 'contains' },
    { name: 'e', ruleKind: 'page', match: 'a_b', matchMode: 'contains' },
    { name: 'f', ruleKind: 'page', match: '', matchMode: 'contains' },
  ];
  const marks: SmartEventMark[] = [
    { kind: 'page', key: '/checkout/step-2' },
    { kind: 'page', key: '/CHECKOUT' },
    { kind: 'page', key: '/cart/checkout' },
    { kind: 'page', key: '/thank-you' },
    { kind: 'page', key: '/thank-you/again' },
    { kind: 'event', key: 'signup_done' },
    { kind: 'event', key: 'signupXdone' },
    { kind: 'event', key: 'save 50% now' },
    { kind: 'event', key: 'save 500 now' },
    { kind: 'page', key: '/a_b/c' },
    { kind: 'page', key: '/axb/c' },
  ];

  it('gives the same answer for every (rule, mark) pair of the right kind', () => {
    let compared = 0;
    for (const rule of rules) {
      const predicate = ruleTextPredicate(rule);
      for (const mark of marks) {
        const kindMatches = (rule.ruleKind === 'page' && mark.kind === 'page') || (rule.ruleKind === 'custom' && mark.kind === 'event');
        if (!kindMatches) continue;
        expect(sqlAnswers(mark.key, predicate), `${rule.name} ~ ${mark.key}`).toBe(markMatchesRule(mark, rule));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(20);
  });

  it('binds exactly the pattern the parity check evaluated', () => {
    const rule = rules[0]!;
    const { query } = render({ all: [{ field: 'smartEvent', op: 'eq', value: 'a' }] }, [rule]);
    expect(query!.params).toContain(ruleTextPredicate(rule)!.pattern);
    expect(query!.sql).toMatch(/lower\(bf_el\.v\) like \$\d+ escape '\\'/);
  });
});
