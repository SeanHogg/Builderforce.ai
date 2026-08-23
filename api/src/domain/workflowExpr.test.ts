import { describe, it, expect } from 'vitest';
import { contextFromInput, evaluateBool, renderTransform, renderValueTemplate } from './workflowExpr';

describe('contextFromInput', () => {
  it('exposes top-level fields of a JSON object payload', () => {
    const ctx = contextFromInput('{"status":"ready","count":3}');
    expect(ctx.status).toBe('ready');
    expect(ctx.count).toBe(3);
    expect(ctx.$).toEqual({ status: 'ready', count: 3 });
  });

  it('wraps a scalar/array payload under input/$', () => {
    expect(contextFromInput('42').$).toBe(42);
    expect(contextFromInput('[1,2]').$).toEqual([1, 2]);
  });

  it('wraps non-JSON text under input', () => {
    const ctx = contextFromInput('hello world');
    expect(ctx.input).toBe('hello world');
    expect(ctx.$).toBe('hello world');
  });
});

describe('evaluateBool', () => {
  const ctx = contextFromInput('{"status":"ready","count":3,"tags":["a","b"],"nested":{"ok":true}}');

  it('treats empty predicate as true (no filtering)', () => {
    expect(evaluateBool('', ctx)).toBe(true);
    expect(evaluateBool('   ', ctx)).toBe(true);
  });

  it('evaluates string equality (the builder hint example)', () => {
    expect(evaluateBool('status == "ready"', ctx)).toBe(true);
    expect(evaluateBool('status == "blocked"', ctx)).toBe(false);
    expect(evaluateBool('status != "blocked"', ctx)).toBe(true);
  });

  it('evaluates numeric comparisons', () => {
    expect(evaluateBool('count > 2', ctx)).toBe(true);
    expect(evaluateBool('count >= 3', ctx)).toBe(true);
    expect(evaluateBool('count < 3', ctx)).toBe(false);
    expect(evaluateBool('count <= 3', ctx)).toBe(true);
  });

  it('does loose string/number equality', () => {
    expect(evaluateBool('count == "3"', ctx)).toBe(true);
    expect(evaluateBool('count == 3', ctx)).toBe(true);
  });

  it('supports contains on strings and arrays', () => {
    expect(evaluateBool('status contains "read"', ctx)).toBe(true);
    expect(evaluateBool('tags contains "a"', ctx)).toBe(true);
    expect(evaluateBool('tags contains "z"', ctx)).toBe(false);
  });

  it('resolves dotted + bracketed paths', () => {
    expect(evaluateBool('nested.ok == true', ctx)).toBe(true);
    expect(evaluateBool('tags[0] == "a"', ctx)).toBe(true);
    expect(evaluateBool('tags[1] == "a"', ctx)).toBe(false);
  });

  it('combines with && and ||', () => {
    expect(evaluateBool('status == "ready" && count > 2', ctx)).toBe(true);
    expect(evaluateBool('status == "ready" && count > 5', ctx)).toBe(false);
    expect(evaluateBool('status == "blocked" || count == 3', ctx)).toBe(true);
    expect(evaluateBool('status == "blocked" || count == 9', ctx)).toBe(false);
  });

  it('treats a bare resolvable path as truthiness', () => {
    expect(evaluateBool('nested.ok', ctx)).toBe(true);
    expect(evaluateBool('missing.field', ctx)).toBe(false);
  });

  it('never throws on malformed author input (conservative)', () => {
    expect(() => evaluateBool('@@ ?? !!', ctx)).not.toThrow();
  });
});

describe('renderTransform', () => {
  const ctx = contextFromInput('{"name":"Acme","plan":{"tier":"pro"},"n":7}');

  it('passes input through unchanged for an empty expression', () => {
    expect(renderTransform('', 'raw text', ctx)).toBe('raw text');
  });

  it('substitutes {{ path }} template spans', () => {
    expect(renderTransform('Hello {{name}} on {{plan.tier}}', '', ctx)).toBe('Hello Acme on pro');
  });

  it('emits a bare path as its stringified value', () => {
    expect(renderTransform('name', '', ctx)).toBe('Acme');
    expect(renderTransform('plan', '', ctx)).toBe('{"tier":"pro"}');
    expect(renderTransform('n', '', ctx)).toBe('7');
  });

  it('emits empty string for an unresolved bare path', () => {
    expect(renderTransform('nope', '', ctx)).toBe('');
  });
});

describe('{{ json … }} spans', () => {
  const ctx = contextFromInput('{"email":"a\\"b@c.com","order":{"id":7},"n":3}');

  it('emits a string as a QUOTED JSON literal, so a mapping stays valid JSON', () => {
    // The whole reason the prefix exists: an unquoted splice breaks the document
    // the first time a value contains a quote.
    const mapped = renderTransform('{"who": {{ json email }}}', '', ctx);
    expect(JSON.parse(mapped)).toEqual({ who: 'a"b@c.com' });
  });

  it('emits objects and numbers as themselves', () => {
    expect(JSON.parse(renderTransform('{"o": {{ json order }}, "n": {{ json n }}}', '', ctx)))
      .toEqual({ o: { id: 7 }, n: 3 });
  });

  it('emits null for a missing path, because a hole in JSON must be a JSON value', () => {
    expect(JSON.parse(renderTransform('{"x": {{ json nope }}}', '', ctx))).toEqual({ x: null });
  });
});

describe('renderValueTemplate', () => {
  const ctx = contextFromInput('{"order":{"id":7},"status":"ready"}');

  it('leaves a literal alone (where renderTransform would read it as a path)', () => {
    expect(renderValueTemplate('hello', 'raw', ctx)).toBe('hello');
    expect(renderTransform('hello', 'raw', ctx)).toBe('');
  });

  it('substitutes a path span, which is what lets an output capture name a field', () => {
    expect(renderValueTemplate('{{ order.id }}', '', ctx)).toBe('7');
  });

  it('still substitutes {{input}} exactly as renderTemplate did', () => {
    expect(renderValueTemplate('{{input}}', 'the payload', contextFromInput('the payload'))).toBe('the payload');
  });
});
