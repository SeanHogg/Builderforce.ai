import { describe, expect, it } from 'vitest';
import { rewriteRelativeImports } from './importRewrite.js';

const files = new Set(['src/a.ts', 'src/b.ts', 'src/util/index.ts', 'src/worker.ts', 'src/c.tsx', 'lib/x.ts', 'src/chat/m.ts']);
const rewrite = (file: string, text: string, moves: Record<string, string>) => rewriteRelativeImports(file, text, new Map(Object.entries(moves)), files);

describe('rewriteRelativeImports', () => {
    it('re-points from, side-effect import, import(), require() and re-exports at a moved target', () => {
        const text = [`import { b } from './b';`, `import './b';`, `const m = await import('./b');`, `const r = require("./b");`, `export * from './b';`].join('\n');
        const out = rewrite('src/a.ts', text, { 'src/b.ts': 'src/tools/b.ts' });
        expect(out.changed).toBe(5);
        expect(out.text).toBe(text.replace(/\.\/b/g, './tools/b'));
    });

    it('re-points vi.mock, vi.importActual and new URL(…, import.meta.url), keeping a ?query suffix', () => {
        const text = [`vi.mock('./b', () => ({}));`, `await vi.importActual('./b');`, `new URL('./worker.ts?worker&url', import.meta.url);`].join('\n');
        const out = rewrite('src/a.ts', text, { 'src/b.ts': 'src/tools/b.ts', 'src/worker.ts': 'src/run/worker.ts' });
        expect(out.text).toBe([`vi.mock('./tools/b', () => ({}));`, `await vi.importActual('./tools/b');`, `new URL('./run/worker.ts?worker&url', import.meta.url);`].join('\n'));
    });

    it('keeps the written style: bare, .js over a .ts source, .ts, and a directory import', () => {
        const text = [`from './b'`, `from './b.js'`, `from './b.ts'`, `from './util'`].join('\n');
        const out = rewrite('src/a.ts', text, { 'src/b.ts': 'src/tools/b.ts', 'src/util/index.ts': 'src/core/util/index.ts' });
        expect(out.text).toBe([`from './tools/b'`, `from './tools/b.js'`, `from './tools/b.ts'`, `from './core/util'`].join('\n'));
    });

    it('when the importer moves too, re-relativizes every specifier, and handles moves that share a target folder', () => {
        const out = rewrite('src/a.ts', `import { b } from './b';\nimport { x } from '../lib/x';\nimport { m } from './chat/m';`, { 'src/a.ts': 'src/tools/a.ts' });
        expect(out.text).toBe(`import { b } from '../b';\nimport { x } from '../../lib/x';\nimport { m } from '../chat/m';`);
        const both = rewrite('src/a.ts', `import { b } from './b';`, { 'src/a.ts': 'src/tools/a.ts', 'src/b.ts': 'src/tools/b.ts' });
        expect(both.text).toBe(`import { b } from './b';`);
        expect(both.changed).toBe(0);
    });

    it('leaves bare packages, aliases, unresolved specifiers and untouched imports alone', () => {
        const text = `import r from 'react';\nimport a from '@app/b';\nimport n from './missing';\nimport c from './c';`;
        const out = rewrite('src/a.ts', text, { 'src/b.ts': 'src/tools/b.ts' });
        expect(out).toEqual({ text, changed: 0 });
    });
});
