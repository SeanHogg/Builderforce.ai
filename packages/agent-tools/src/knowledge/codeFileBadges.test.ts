import { describe, expect, it } from 'vitest';
import { codeParser, isCodePath } from './codePack.js';
import { contentBadges } from './codeFileBadges.js';
import { extractSymbols } from '../symbols.js';

const ctx = { rootId: 'r', knownKeys: new Map(), resolvePath: () => undefined };
const doc = (path: string, text: string) => ({ id: path, tenantId: 't', content: { kind: 'text' as const, text, mediaType: 'text/plain' } });
const badgesOf = (path: string, text: string) => {
  const parser = codeParser();
  return parser.extract!(doc(path, text), parser.parse(doc(path, text)), ctx).nodes[0]!.badges!;
};

describe('contentBadges', () => {
  it('derives complexity, routes and patterns from one file', () => {
    const text = [
      "import { Hono } from 'hono';",
      'export class OrderRepository {',
      '  find(id: string) { return id ? 1 : 0; }',
      '}',
      "app.get('/orders', (c) => c.json([]));",
    ].join('\n');
    const badges = contentBadges('src/db/orderRepository.ts', text, extractSymbols('src/db/orderRepository.ts', text));
    expect(badges).toMatchObject({ routes: 'GET /orders', patterns: 'repository' });
    // find: 1 + ternary = 2; the route handler arrow has an expression body, so it adds to module level (none).
    expect(badges['complexity']).toBe(2);
    expect(badges['maxComplexity']).toBe(2);
  });

  it('adds no pattern, route or complexity badge a file has no evidence for (only its size counts)', () => {
    expect(contentBadges('src/x.ts', 'export const x = 1;', extractSymbols('src/x.ts', 'export const x = 1;'))).toEqual({ lines: 1, exports: 1 });
  });

  it('does not count a trailing newline as a line: 1000 lines is not a god module, 1001 is', () => {
    const body = (n: number) => Array.from({ length: n }, (_, i) => `const v${i} = ${i};`).join('\n') + '\n';
    const ok = contentBadges('src/a.ts', body(1000), extractSymbols('src/a.ts', body(1000)));
    expect(ok['lines']).toBe(1000);
    expect(String(ok['patterns'] ?? '').split(',')).not.toContain('god-module');
    const big = contentBadges('src/b.ts', body(1001), extractSymbols('src/b.ts', body(1001)));
    expect(big['lines']).toBe(1001);
    expect(String(big['patterns']).split(',')).toContain('god-module');
  });

  it('stores the counts the god-module detector uses, so the finding can show what tripped it', () => {
    const text = Array.from({ length: 1001 }, (_, i) => `export const v${i} = ${i};`).join('\n');
    const badges = contentBadges('src/big.ts', text, extractSymbols('src/big.ts', text));
    expect(badges).toMatchObject({ lines: 1001, exports: 1001 });
    expect(String(badges['patterns']).split(',')).toContain('god-module');
  });
});

describe('shell scripts are code, not docs', () => {
  it('accepts .sh .bash .zsh .ps1 as code paths', () => {
    expect(['scripts/build.sh', 'a.bash', 'b.zsh', 'c.ps1'].every(isCodePath)).toBe(true);
  });

  it('the code parser reads a shell script (so `[[ … ]]` is never a wiki link) and scores it', () => {
    const text = 'if [[ -f x ]] && [[ -d y ]]; then echo ok; fi\n';
    const badges = badgesOf('scripts/check.sh', text);
    expect(codeParser().accepts(doc('scripts/check.sh', text))).toBe(true);
    expect(badges).toMatchObject({ language: 'shell', symbols: 0, exports: 0, complexity: 3, maxComplexity: 3 });
  });
});
