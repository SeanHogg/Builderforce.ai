/**
 * fileFacts.effective.test.ts — a rule reads route guards ONLY through `entryPointsOf`, which composes memory's
 * `effectiveGuards` over the side (PRD 41 §C5.1): a `use` registered before a route guards it, one registered after does
 * not, and a sub-router mounted from another file answers under the prefix with the mounting router's guards.
 */

import { describe, expect, it } from 'vitest';
import { FACTS_EXTRACTOR_VERSION, type EntryPointFact, type FileFacts } from '@seanhogg/builderforce-memory/knowledge';
import type { RuleInput, SideFacts, SideText } from '../../contract.js';
import { entryPointsOf } from './fileFacts.js';

const facts = (over: Partial<FileFacts>): FileFacts => ({
    factsVersion: FACTS_EXTRACTOR_VERSION, extractor: 'tree-sitter@3.1/typescript=x/eol-lf@1', language: 'typescript', contentHash: 'h',
    symbols: [], imports: [], exports: [], entryPoints: [], calls: [], complexity: [], capabilityImports: [], ...over,
});
const route = (key: string, order: number, router: string): EntryPointFact => ({ kind: 'http-route', key, symbol: 'h', guards: [], inputs: [], chain: [], order, router });

const side = (fileFacts: Map<string, FileFacts>): SideFacts => ({
    manifestGeneration: 'g', merkleRoot: 'm', findings: [], imports: new Map(), badges: new Map(), meta: {}, fileFacts,
});
const input = (s: SideFacts): RuleInput => ({
    changed: [], registries: {} as RuleInput['registries'], runKind: 'standard', churn: new Map(),
    before: new Map<string, SideText>(), after: new Map<string, SideText>(), beforeFacts: s, afterFacts: s,
});

describe('entryPointsOf: effective guards (uses, order, mounts)', () => {
    const app = facts({
        imports: [{ specifier: './users', names: ['users'], resolved: 'src/users.ts' }],
        uses: [{ path: '', guards: ['requireAuth'], order: 1, router: 'app' }],
        entryPoints: [route('GET /health', 0, 'app'), route('GET /me', 2, 'app')],
        mounts: [{ prefix: '/users', target: './users', order: 3, router: 'app' }],
    });
    const users = facts({ entryPoints: [route('GET /:id', 0, 'users')] });
    const i = input(side(new Map([['src/app.ts', app], ['src/users.ts', users]])));

    it('a use guards routes registered after it, never before', () => {
        expect(Object.fromEntries(entryPointsOf(i, 'after', 'src/app.ts')!.map((e) => [e.key, e.guards]))).toEqual({ 'GET /health': [], 'GET /me': ['requireAuth'] });
    });

    it('a mounted sub-router answers under the prefix with the mounting router\'s guards (read from its own file)', () => {
        const mounted = entryPointsOf(i, 'after', 'src/users.ts')!;
        expect(mounted.map((e) => [e.key, e.guards, e.via])).toEqual([['GET /users/:id', ['requireAuth'], ['/users']]]);
        expect(mounted[0]!.chain).toContain('src/app.ts');
    });

    it('no facts for the file: undefined (the rule keeps its text path)', () => {
        expect(entryPointsOf(i, 'after', 'src/other.ts')).toBeUndefined();
    });
});
