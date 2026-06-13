import { describe, it, expect } from 'vitest';
import { contextFromInput, evaluateBool, renderTransform } from './workflowExpr';

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
