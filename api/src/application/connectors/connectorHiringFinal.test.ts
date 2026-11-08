/**
 * Regression tests for the connector half of the fourth board-import review: a board must
 * never choose where a credentialled call goes (the token and filter-id lookup may only fill
 * a query or body param), the end-of-list flag of a token-paged board, and the wire helpers
 * moved out of the runtime.
 */
import { describe, expect, it } from 'vitest';
import { HIRING_CONNECTORS } from './defaults/hiring';
import { ConnectorManifestError, parseConnectorManifest, type ConnectorManifest } from './connectorManifest';
import { parseStoredConnectorManifest } from './connectorStoredManifest';
import { getDeep } from './connectorRuntime';
import { joinQuery, rawQueryPair, readBodyFields } from './connectorRuntimeQuery';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const lever = HIRING_CONNECTORS.find((m) => m.key === 'lever-postings')!;
const ashby = HIRING_CONNECTORS.find((m) => m.key === 'ashby-postings')!;

/** A copy of `manifest` with `edit` applied to the action `key`. */
const edited = (manifest: ConnectorManifest, key: string, edit: (action: Record<string, any>) => void): unknown => {
  const copy = clone(manifest);
  edit(copy.actions.find((a) => a.key === key) as unknown as Record<string, any>);
  return copy;
};
const errorsOf = (raw: unknown): string[] => {
  try { parseConnectorManifest(raw); return []; } catch (e) { return e instanceof ConnectorManifestError ? e.errors : [String(e)]; }
};

/** Declare `name` at `location` on an action, with the path the location requires (`url`: empty; `path`: a placeholder). */
const place = (action: Record<string, any>, name: string, location: string): void => {
  action.params[name] = { type: 'string', in: location, description: 'x' };
  if (location === 'url') action.path = '';
  if (location === 'path') action.path = `${action.path}/{${name}}`;
};

describe('regression: a board cannot choose where a credentialled call goes', () => {
  it('the built-ins satisfy the rule', () => {
    expect(errorsOf(lever)).toEqual([]);
    expect(errorsOf(ashby)).toEqual([]);
  });

  it.each(['url', 'path'] as const)('rejects a nextToken whose param is `in: %s`', (location) => {
    const raw = edited(lever, 'list_opportunities', (a) => place(a, 'offset', location));
    expect(errorsOf(raw).join(' ')).toMatch(/nextToken\.param "offset" must be a query or body param/);
  });

  it('accepts a nextToken param in the body', () => {
    const raw = edited(lever, 'list_opportunities', (a) => { a.params.offset = { type: 'string', in: 'body', description: 'token' }; });
    expect(errorsOf(raw)).toEqual([]);
  });

  it.each(['url', 'path', 'header'] as const)('rejects a filterIdFrom whose idParam is `in: %s`', (location) => {
    const raw = edited(ashby, 'get_posting', (a) => place(a, 'jobPostingId', location));
    expect(errorsOf(raw).join(' ')).toMatch(/filterIdFrom\.idParam "jobPostingId" must be a query or body param of "get_posting"/);
  });

  it('rejects a filterIdFrom naming an action that does not exist', () => {
    const raw = edited(ashby, 'list_applications', (a) => { a.applicants.filterIdFrom.action = 'nope'; });
    expect(errorsOf(raw).join(' ')).toMatch(/filterIdFrom\.action "nope" is not an action of this connector/);
  });

  it('rejects a filterIdFrom that would WRITE (mutates: true)', () => {
    const raw = edited(ashby, 'get_posting', (a) => { a.mutates = true; });
    expect(errorsOf(raw).join(' ')).toMatch(/filterIdFrom\.action "get_posting" must be a read/);
  });

  it('regression: rejects a postingParam `in: url` when filterIdFrom is set, and degrades a stored one', () => {
    const raw = edited(ashby, 'list_applications', (a) => place(a, 'jobId', 'url'));
    expect(errorsOf(raw).join(' ')).toMatch(/applicants\.postingParam "jobId" must be a query, body or path param/);
    const stored = parseStoredConnectorManifest(raw);
    expect(stored.actions.find((a) => a.key === 'list_applications')?.applicants).toBeUndefined();
    expect(stored.degraded?.join(' ')).toMatch(/list_applications.*applicants mapping disabled.*postingParam "jobId"/);
  });

  it('a lenient read of a stored manifest DISABLES the mapping with a reason instead of throwing', () => {
    const raw = edited(lever, 'list_opportunities', (a) => place(a, 'offset', 'path'));
    expect(() => parseConnectorManifest(raw)).toThrow(ConnectorManifestError); // a write is strict
    const stored = parseStoredConnectorManifest(raw);
    expect(stored.actions.find((a) => a.key === 'list_opportunities')?.applicants).toBeUndefined();
    expect(stored.degraded?.join(' ')).toMatch(/list_opportunities.*applicants mapping disabled.*nextToken\.param "offset"/);
    expect(stored.actions.find((a) => a.key === 'list_postings')).toBeDefined(); // the rest of the connector stays
  });
});

describe('nextToken.done — the end-of-list flag', () => {
  const withDone = (done: unknown): unknown => edited(lever, 'list_opportunities', (a) => { a.applicants.nextToken.done = done; });

  it('Lever declares hasNext === false', () => {
    const action = lever.actions.find((a) => a.key === 'list_opportunities')!;
    expect(action.applicants?.nextToken?.done).toEqual({ select: 'hasNext', equals: 'false' });
    expect(parseConnectorManifest(lever).actions.find((a) => a.key === 'list_opportunities')?.applicants?.nextToken?.done)
      .toEqual({ select: 'hasNext', equals: 'false' });
  });

  it.each([
    ['not an object', 'hasNext'],
    ['a header selector', { select: 'header:x-more', equals: 'false' }],
    ['a wildcard path', { select: 'a.*.b', equals: 'false' }],
    ['no value', { select: 'hasNext' }],
    ['a value that is not short text', { select: 'hasNext', equals: 'no way!' }],
  ])('rejects a done that is %s', (_label, done) => {
    expect(errorsOf(withDone(done)).join(' ')).toMatch(/nextToken\.done/);
  });
});

describe('connectorRuntimeQuery', () => {
  it('readBodyFields keeps strings, finite numbers and booleans (an end-of-list flag), and nothing else', () => {
    const body = { next: ' abc ', n: 7, hasNext: false, nested: { x: 1 }, blank: '  ', inf: Number.POSITIVE_INFINITY };
    expect(readBodyFields(body, ['next', 'n', 'hasNext', 'nested', 'blank', 'inf', 'missing'], getDeep))
      .toEqual({ next: 'abc', n: '7', hasNext: 'false' });
  });

  it('rawQueryPair is null for a value that could end the param, and the pair for a wire-safe one', () => {
    expect(rawQueryPair('ids', 'List(1%3A2)')).toBe('ids=List(1%3A2)');
    expect(rawQueryPair('ids', 'a&b=c')).toBeNull();
    expect(rawQueryPair('ids', '50%')).toBeNull();
  });

  it('joinQuery puts the raw pairs after the encoded ones and drops empties', () => {
    const query = new URLSearchParams({ a: 'x y' });
    expect(joinQuery(query, ['k=List(1)'])).toBe('a=x+y&k=List(1)');
    expect(joinQuery(new URLSearchParams(), [])).toBe('');
  });
});
