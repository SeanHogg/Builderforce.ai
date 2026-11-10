/**
 * resolveFacts.test.ts — RAW facts resolve against a LISTING (PRD 41 §B3, H3): the same raw facts resolve to each
 * listing's files (b.ts, then b/index.ts after a rename), a guard chain's `import:` specifiers become files, and a
 * store's resolved facts go back to raw and resolve to themselves again.
 */

import { describe, expect, it } from 'vitest';
import { canonicalJson, FACTS_EXTRACTOR_VERSION, type FileFacts } from '@seanhogg/builderforce-memory/knowledge';
import { importResolver } from './importResolver.js';
import { chainImport, resolutionKey, resolvedKey, resolveFileFacts, unresolveFileFacts } from './resolveFacts.js';

const raw: FileFacts = {
    factsVersion: FACTS_EXTRACTOR_VERSION, extractor: 't', language: 'typescript', contentHash: 'h',
    symbols: [], exports: [], calls: [], complexity: [], capabilityImports: [],
    imports: [{ specifier: './b', names: ['b'] }, { specifier: './auth', names: ['requireAuth'] }, { specifier: 'hono', names: ['Hono'] }],
    entryPoints: [{ kind: 'http-route', key: 'GET /x', symbol: 'h', guards: ['requireAuth'], inputs: [], chain: [chainImport('./auth'), chainImport('hono')] }],
};
const listed = (...files: string[]) => importResolver((f) => files.includes(f));

describe('resolveFileFacts', () => {
    it('resolves imports and guard chains against the listing; packages and missing files stay unresolved', () => {
        const r = resolveFileFacts('src/a.ts', raw, listed('src/a.ts', 'src/b.ts', 'src/auth.ts'));
        expect(r.imports.map((i) => i.resolved)).toEqual(['src/b.ts', 'src/auth.ts', undefined]);
        expect(r.entryPoints[0]!.chain).toEqual(['src/auth.ts']);
    });

    it('the same raw facts follow the listing: b.ts renamed to b/index.ts', () => {
        expect(resolveFileFacts('src/a.ts', raw, listed('src/b/index.ts')).imports[0]!.resolved).toBe('src/b/index.ts');
        expect(resolutionKey('src/a.ts', raw, listed('src/b.ts'))).not.toBe(resolutionKey('src/a.ts', raw, listed('src/b/index.ts')));
    });

    it('unresolve then resolve against the same listing is the identity (a store resumes from resolved facts)', () => {
        const resolve = listed('src/a.ts', 'src/b.ts', 'src/auth.ts');
        const resolved = resolveFileFacts('src/a.ts', raw, resolve);
        const back = unresolveFileFacts(resolved);
        expect(back.imports.every((i) => i.resolved === undefined)).toBe(true);
        expect(back.entryPoints[0]!.chain).toEqual([chainImport('./auth')]);
        expect(canonicalJson(resolveFileFacts('src/a.ts', back, resolve))).toBe(canonicalJson(resolved));
        expect(resolvedKey(resolved)).toBe(resolutionKey('src/a.ts', back, resolve));
    });
});
