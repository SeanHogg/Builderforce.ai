import { describe, expect, it } from 'vitest';
import { GOD_MODULE_LIMITS } from '@seanhogg/builderforce-memory/knowledge';
import { detectPatterns, importSpecifiers, patternsBadge, type PatternFacts } from './codePatterns.js';

const facts = (over: Partial<PatternFacts>): PatternFacts => ({
  path: 'src/x.ts', base: 'x', lines: 10, exported: [], imports: [], text: '', maxComplexity: 1, ...over,
});

describe('detectPatterns', () => {
  it('recognises names and exported symbols, sorted', () => {
    const f = facts({
      path: 'src/db/userRepository.ts', base: 'userRepository',
      exported: [{ name: 'UserRepository', kind: 'class' }, { name: 'ClockPort', kind: 'interface' }],
    });
    expect(detectPatterns(f)).toEqual(['port', 'repository']);
    expect(patternsBadge(f)).toBe('port,repository');
  });

  it('detects factory, adapter, registry, facade, strategy, use-case and typed-client', () => {
    expect(detectPatterns(facts({ exported: [{ name: 'ModelFactory', kind: 'class' }] }))).toEqual(['factory']);
    expect(detectPatterns(facts({ base: 'createStore', exported: [{ name: 'createStore', kind: 'function' }] }))).toEqual(['factory']);
    expect(detectPatterns(facts({ base: 'stripeAdapter' }))).toEqual(['adapter']);
    expect(detectPatterns(facts({ base: 'toolRegistry' }))).toEqual(['registry']);
    expect(detectPatterns(facts({ base: 'billingFacade' }))).toEqual(['facade']);
    expect(detectPatterns(facts({ exported: [{ name: 'RetryStrategy', kind: 'class' }] }))).toEqual(['strategy']);
    expect(detectPatterns(facts({ path: 'src/use-cases/place.ts', base: 'place' }))).toEqual(['use-case']);
    expect(detectPatterns(facts({ base: 'apiClient', text: 'await fetch(url)' }))).toEqual(['typed-client']);
    expect(detectPatterns(facts({ base: 'apiClient', text: 'no network' }))).toEqual([]);
  });

  it('detects read-through-cache from the call or the import, and observer / middleware', () => {
    expect(detectPatterns(facts({ text: 'return getOrSetCached(key, load)' }))).toEqual(['read-through-cache']);
    expect(detectPatterns(facts({ imports: ['@builderforce/read-through-cache'] }))).toEqual(['read-through-cache']);
    expect(detectPatterns(facts({ imports: ['node:events'] }))).toEqual(['observer']);
    expect(detectPatterns(facts({ text: 'export const m = async (c, next) => { await next(); }' }))).toEqual(['middleware-chain']);
  });

  it('flags a god module by lines, exports or complexity', () => {
    expect(detectPatterns(facts({ lines: 1001 }))).toEqual(['god-module']);
    expect(detectPatterns(facts({ lines: 1000 }))).toEqual([]);
    expect(detectPatterns(facts({ exported: Array.from({ length: 41 }, (_, i) => ({ name: `f${i}`, kind: 'function' as const })) }))).toEqual(['god-module']);
    expect(detectPatterns(facts({ maxComplexity: 61 }))).toEqual(['god-module']);
  });

  it('holds files to the limits memory owns (the finding shows the same numbers)', () => {
    expect(detectPatterns(facts({ lines: GOD_MODULE_LIMITS.lines + 1 }))).toEqual(['god-module']);
    expect(detectPatterns(facts({ lines: GOD_MODULE_LIMITS.lines }))).toEqual([]);
    expect(detectPatterns(facts({ maxComplexity: GOD_MODULE_LIMITS.complexity + 1 }))).toEqual(['god-module']);
    expect(detectPatterns(facts({ maxComplexity: GOD_MODULE_LIMITS.complexity }))).toEqual([]);
  });

  it('has no badge when nothing matches', () => {
    expect(patternsBadge(facts({}))).toBeUndefined();
  });
});

describe('importSpecifiers', () => {
  it('reads static, dynamic, side-effect and require specifiers', () => {
    const src = "import a from './a.js';\nimport('./b.js');\nconst c = require('c');\nexport * from './d';\nimport './e.css';";
    expect(importSpecifiers(src)).toEqual(['./a.js', './b.js', 'c', './d', './e.css']);
  });
});
