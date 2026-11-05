import { describe, expect, it } from 'vitest';
import { cyclomaticComplexity } from './codeComplexity.js';

describe('cyclomaticComplexity', () => {
  it('scores 1 plus the decision points of a function', () => {
    const src = 'function a(x, y, z) { if (x && y) { return 1; } else if (z) { return 2; } return x ? 3 : 4; }';
    expect(cyclomaticComplexity('a.ts', src)).toEqual({ total: 5, max: 5, functions: 1 });
  });

  it('counts loops, case, catch and the nullish operator', () => {
    const src = 'function f(a) { for (const i of a) {} while (a) {} switch (a) { case 1: break; case 2: break; } try {} catch (e) {} return a ?? 0; }';
    // 1 + for + while + 2 case + catch + ??
    expect(cyclomaticComplexity('f.js', src).total).toBe(7);
  });

  it('ignores decision words inside strings and comments', () => {
    const src = 'function b() { // if (a) && ||\n const s = "if while && ?"; /* for case */ return s; }';
    expect(cyclomaticComplexity('b.ts', src)).toEqual({ total: 1, max: 1, functions: 1 });
  });

  it('does not count an optional parameter or optional chaining as a ternary', () => {
    expect(cyclomaticComplexity('c.ts', 'function c(a?: string) { return a?.length; }').total).toBe(1);
  });

  it('keeps a nested function out of its parent: sum over functions, max is the worst', () => {
    const src = 'function outer() { if (a) {} const inner = () => { if (b) {} if (c) {} }; }';
    expect(cyclomaticComplexity('o.ts', src)).toEqual({ total: 5, max: 3, functions: 2 });
  });

  it('scores class methods, with a return type', () => {
    const src = 'class A { run(x: number[]): void { for (const i of x) { if (i) { } } } }';
    expect(cyclomaticComplexity('a.ts', src)).toEqual({ total: 3, max: 3, functions: 1 });
  });

  it('reads Python by indentation', () => {
    const src = 'def f(a):\n    if a and b:\n        return 1\n    for i in a:\n        pass\n\ndef g():\n    return 1\n';
    expect(cyclomaticComplexity('m.py', src)).toEqual({ total: 5, max: 4, functions: 2 });
  });

  it('scores a file with decisions but no function as one unit, and a plain one as nothing', () => {
    expect(cyclomaticComplexity('s.ts', 'if (a) {}')).toEqual({ total: 2, max: 2, functions: 1 });
    expect(cyclomaticComplexity('s.ts', 'export const x = 1;')).toEqual({ total: 0, max: 0, functions: 0 });
  });

  it('does not count an optional method `foo?():` as a ternary', () => {
    expect(cyclomaticComplexity('i.ts', 'interface I { foo?(): void }\nfunction f() { return 1; }').total).toBe(1);
  });

  it('scores PowerShell elseif / foreach / -and / -or', () => {
    const src = 'function Test-It {\n  if ($a -and $b) { 1 } elseif ($c -or $d) { 2 }\n  foreach ($x in $xs) { }\n}\n';
    // 1 + if + -and + elseif + -or + foreach
    expect(cyclomaticComplexity('t.ps1', src)).toEqual({ total: 6, max: 6, functions: 1 });
  });

  it('attributes decisions to the innermost function across deep nesting, in one pass', () => {
    const depth = 40;
    const open = Array.from({ length: depth }, (_, i) => `function f${i}() { if (a) {}`).join(' ');
    const src = `${open}${' }'.repeat(depth)}`;
    const r = cyclomaticComplexity('deep.ts', src);
    expect(r.functions).toBe(depth);
    expect(r.max).toBe(2);
    expect(r.total).toBe(depth * 2);
  });

  it('does not stall on a long run of parentheses', () => {
    const src = `function g(${'('.repeat(3000)}) { }`;
    expect(cyclomaticComplexity('p.ts', src).functions).toBeLessThanOrEqual(1);
  });

  it('is empty for a language it has no rule for', () => {
    expect(cyclomaticComplexity('a.md', 'if (a) {}')).toEqual({ total: 0, max: 0, functions: 0 });
    expect(cyclomaticComplexity('a.css', 'a { }')).toEqual({ total: 0, max: 0, functions: 0 });
  });
});
