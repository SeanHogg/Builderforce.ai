/**
 * rules/support/fileFacts.test.ts — the FileFacts seam of a RuleInput (PRD 41 §B3): a rule reads a side's entry points,
 * test facts and calls by the file's logical path (a renamed file's before facts under its old path), gets nothing when
 * the host supplied no facts, and compares two sides only when one extractor produced both (C9).
 */

import { describe, expect, it } from 'vitest';
import type { FileFacts } from '@seanhogg/builderforce-memory/knowledge';
import type { RuleInput, SideFacts, SideText } from '../../contract.js';
import { callsOf, comparableFacts, entryPointsOf, factsTestFactsOf, sideFileFacts } from './fileFacts.js';

const facts = (over: Partial<FileFacts> = {}): FileFacts => ({
    factsVersion: 3, extractor: 'tree-sitter@3.0/typescript=1/eol-lf@1', language: 'typescript', contentHash: 'h',
    symbols: [], imports: [], exports: [], entryPoints: [], calls: [], complexity: [], capabilityImports: [], ...over,
});
const side = (fileFacts?: Map<string, FileFacts>): SideFacts => ({
    manifestGeneration: 'g', merkleRoot: 'm', findings: [], imports: new Map(), badges: new Map(), meta: {}, ...(fileFacts ? { fileFacts } : {}),
});
const input = (before: SideFacts, after: SideFacts, renamedFrom?: string): RuleInput => ({
    changed: [], registries: {} as RuleInput['registries'], runKind: 'standard', churn: new Map(),
    before: new Map<string, SideText>([['src/new.ts', { path: renamedFrom ?? 'src/new.ts', text: '' }]]),
    after: new Map<string, SideText>([['src/new.ts', { path: 'src/new.ts', text: '' }]]),
    beforeFacts: before, afterFacts: after,
});

const route = { kind: 'http-route' as const, key: 'POST /x', symbol: 'h', guards: ['requireAuth'], inputs: [], chain: ['src/auth.ts'] };

describe('rules/support/fileFacts', () => {
    it('reads entry points, test facts and calls of each side; a renamed file\'s before facts by its old path', () => {
        const before = side(new Map([['src/old.ts', facts({ entryPoints: [route] })]]));
        const after = side(new Map([['src/new.ts', facts({ entryPoints: [{ ...route, guards: [] }], calls: [{ callee: 'db.get', enclosing: 'h', inLoop: true, awaited: true, count: 1 }], testFacts: { tests: [], snapshotFiles: [] } })]]));
        const i = input(before, after, 'src/old.ts');
        expect(entryPointsOf(i, 'before', 'src/new.ts')?.[0]?.guards).toEqual(['requireAuth']);
        expect(entryPointsOf(i, 'after', 'src/new.ts')?.[0]?.guards).toEqual([]);
        expect(callsOf(i, 'after', 'src/new.ts')?.[0]).toMatchObject({ inLoop: true, awaited: true });
        expect(factsTestFactsOf(i, 'after', 'src/new.ts')).toEqual({ tests: [], snapshotFiles: [] });
        expect(comparableFacts(i, 'src/new.ts')).toBeDefined();
    });

    it('a host without facts gives undefined, so a rule keeps its text path', () => {
        const i = input(side(), side());
        expect(sideFileFacts(i, 'after', 'src/new.ts')).toBeUndefined();
        expect(entryPointsOf(i, 'before', 'src/new.ts')).toBeUndefined();
        expect(comparableFacts(i, 'src/new.ts')).toBeUndefined();
    });

    it('two sides from different extractors are never compared (C9)', () => {
        const i = input(side(new Map([['src/new.ts', facts({ extractor: 'regex@3.0/eol-lf@1' })]])), side(new Map([['src/new.ts', facts()]])));
        expect(comparableFacts(i, 'src/new.ts')).toBeUndefined();
    });
});
