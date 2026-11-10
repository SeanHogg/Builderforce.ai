import { describe, expect, it } from 'vitest';
import { resolveRelativePath, srcRef, type Extracted } from '@seanhogg/builderforce-memory/knowledge';
import { fileRollup, listedModuleResolution, moduleFileCandidates, moduleFileOf, repointRollupEdges } from './codeRollup.js';
import { codeParser } from './codePack.js';
import { buildCodeGraph } from './codeGraph.js';
import { createCodePack } from './codePack.js';
import { loadModuleAliases } from './moduleAliasLoader.js';
import { aliasCandidates, resolveModuleAlias } from './moduleAliases.js';

const ROOT = 'r';
const SERVICE = [
    'import { Repo } from "./repo.js";',
    'import { z } from "zod";',
    'export class Service {',
    '  constructor(private readonly repo: Repo) {}',
    '  run(id: string) {',
    '    this.repo.get(id);',
    '    this.repo.get(id);',
    '    return z.parse(id);',
    '  }',
    '}',
    '',
].join('\n');
const REPO = ['export class Repo {', '  get(id: string) {', '    return id;', '  }', '}', ''].join('\n');

describe('codeRollup', () => {
    it('folds a file\'s relations into one file → file edge per (target, kind), weighted by relations (calls: sites); a bare specifier waits as node_modules/<specifier> for repoint, same-file targets are no file edge', () => {
        const edges = fileRollup(ROOT, 'src/service.ts', SERVICE, resolveRelativePath);
        expect(edges).toEqual([
            { from: srcRef(ROOT, 'src/service.ts'), to: srcRef(ROOT, 'node_modules/zod'), kind: 'calls', weight: 1, origin: 'extracted' },
            { from: srcRef(ROOT, 'src/service.ts'), to: srcRef(ROOT, 'src/repo.js'), kind: 'calls', weight: 2, origin: 'extracted' },
            { from: srcRef(ROOT, 'src/service.ts'), to: srcRef(ROOT, 'src/repo.js'), kind: 'composes', weight: 1, origin: 'extracted' },
        ]);
    });

    it('weighs a calls edge by every call, not only the sites a relation keeps', () => {
        const calls = Array.from({ length: 40 }, () => '    this.repo.get(id);').join('\n');
        const src = SERVICE.replace('    this.repo.get(id);\n    this.repo.get(id);', calls);
        const edges = fileRollup(ROOT, 'src/service.ts', src, resolveRelativePath);
        expect(edges.find((e) => e.kind === 'calls' && e.to === srcRef(ROOT, 'src/repo.js'))!.weight).toBe(40);
    });

    it('moduleFileOf finds the TS source of a .js import, a source extension or an index file', () => {
        const has = (files: string[]) => (p: string) => files.includes(p);
        expect(moduleFileOf('src/repo.js', has(['src/repo.ts']))).toBe('src/repo.ts');
        expect(moduleFileOf('src/repo', has(['src/repo.tsx']))).toBe('src/repo.tsx');
        expect(moduleFileOf('src/lib', has(['src/lib/index.ts']))).toBe('src/lib/index.ts');
        expect(moduleFileOf('src/gone', has(['src/repo.ts']))).toBeUndefined();
        expect(moduleFileCandidates('a.js')[0]).toBe('a.js');
    });

    it('repoints each rollup edge to the file of the root its module names, drops one that names none, keeps other edges', () => {
        const x: Extracted = {
            sourceRef: srcRef(ROOT, 'src/service.ts'), sourceHash: 'h', nodes: [], keys: [],
            edges: [
                { from: srcRef(ROOT, 'src/service.ts'), to: srcRef(ROOT, 'src/repo.js'), kind: 'calls', weight: 2, origin: 'extracted' },
                { from: srcRef(ROOT, 'src/service.ts'), to: srcRef(ROOT, 'src/repo'), kind: 'calls', weight: 1, origin: 'extracted' },
                { from: srcRef(ROOT, 'src/service.ts'), to: srcRef(ROOT, 'src/gone.js'), kind: 'uses', weight: 1, origin: 'extracted' },
                { from: srcRef(ROOT, 'src/service.ts'), to: srcRef(ROOT, 'src/gone.js'), kind: 'references', weight: 1, origin: 'extracted' },
            ],
        };
        const [out] = repointRollupEdges(ROOT, [x], new Set(['src/service.ts', 'src/repo.ts']));
        expect(out!.edges).toEqual([
            { from: srcRef(ROOT, 'src/service.ts'), to: srcRef(ROOT, 'src/gone.js'), kind: 'references', weight: 1, origin: 'extracted' },
            { from: srcRef(ROOT, 'src/service.ts'), to: srcRef(ROOT, 'src/repo.ts'), kind: 'calls', weight: 3, origin: 'extracted' },
        ]);
    });

    // regression: hired.video (2026-11-10) — 10,493 of 12,199 imports were tsconfig path aliases (`@/lib/x`, `@shared/x`), read as
    // packages, so the rollup dropped most cross-file edges. The nearest tsconfig above a file (JSONC, `extends` followed) maps them,
    // AT EXTRACT TIME: the stored edge holds the resolved path, so a host without file access builds the same graph.
    it('regression: the extract stores an alias import\'s resolved module path, through the nearest config; a package stays node_modules/<spec>', async () => {
        const configs: Record<string, string> = {
            'web/tsconfig.json': '{\n  // the app\n  "extends": "./tsconfig.base.json",\n  "compilerOptions": { "strict": true, },\n}',
            'web/tsconfig.base.json': '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"], "@shared/*": ["../shared/*"], } } }',
            'api/tsconfig.json': '{ "compilerOptions": { /* api */ "paths": { "@shared/*": ["../shared/*"] } } }',
        };
        const files = ['web/src/page.tsx', 'web/src/lib/auth.ts', 'shared/money.ts', 'api/src/route.ts'];
        const modules = listedModuleResolution(await loadModuleAliases(files, async (p) => configs[p]), new Set(files));
        const { aliases, exists } = modules;
        expect(resolveModuleAlias('web/src/page.tsx', '@/lib/auth', aliases, exists)).toBe('web/src/lib/auth');
        expect(resolveModuleAlias('web/src/page.tsx', '@shared/money', aliases, exists)).toBe('shared/money');
        expect(resolveModuleAlias('api/src/route.ts', '@shared/money', aliases, exists)).toBe('shared/money');
        // api's nearest config declares no `@/*`: there it stays a package, as `react` does everywhere.
        expect(resolveModuleAlias('api/src/route.ts', '@/lib/auth', aliases, exists)).toBeNull();
        expect(resolveModuleAlias('web/src/page.tsx', 'react', aliases, exists)).toBeNull();

        const page = ['import { login } from "@/lib/auth";', 'import { useState } from "react";', 'export function Page() {', '  login();', '  useState();', '}', ''].join('\n');
        const parser = codeParser(undefined, modules);
        const ctx = { rootId: ROOT, knownKeys: new Map(), resolvePath: resolveRelativePath };
        const x = parser.extract!({ id: 'web/src/page.tsx', content: { kind: 'text', text: page }, metadata: {} } as never, [], ctx);
        expect(x.edges.filter((e) => e.kind === 'calls').map((e) => e.to)).toEqual([srcRef(ROOT, 'node_modules/react'), srcRef(ROOT, 'web/src/lib/auth')]);
        // The graph needs no aliases: the stored edge already names the module.
        const [out] = repointRollupEdges(ROOT, [x], new Set(files));
        expect(out!.edges.filter((e) => e.kind === 'calls')).toEqual([{ from: srcRef(ROOT, 'web/src/page.tsx'), to: srcRef(ROOT, 'web/src/lib/auth.ts'), kind: 'calls', weight: 1, origin: 'extracted' }]);
    });

    it('regression: a multi-target alias takes its first target that exists — the same answer from the extract and from the candidate list a disk probe walks', async () => {
        const configs: Record<string, string> = { 'tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["./src/*", "./generated/*"] } } }' };
        const files = ['src/page.ts', 'generated/api.ts'];
        const modules = listedModuleResolution(await loadModuleAliases(files, async (p) => configs[p]), new Set(files));
        expect(aliasCandidates('src/page.ts', '@/api', modules.aliases)).toEqual(['src/api', 'generated/api']);
        expect(resolveModuleAlias('src/page.ts', '@/api', modules.aliases, modules.exists)).toBe('generated/api');
        // The VS Code answer probes the same list in order (here: the first candidate with a file).
        expect(aliasCandidates('src/page.ts', '@/api', modules.aliases).find((c) => moduleFileOf(c, (f) => files.includes(f)))).toBe('generated/api');
    });

    it('regression: an import by baseUrl alone resolves only when the module exists; longest prefix wins; an extends cycle ends', async () => {
        const configs: Record<string, string> = {
            'tsconfig.json': '{ "extends": "./b.json", "compilerOptions": { "baseUrl": "src", "paths": { "@/*": ["./a/*"], "@/deep/*": ["./deep/*"] } } }',
            'b.json': '{ "extends": "./tsconfig.json" }',
        };
        const files = ['src/page.ts', 'src/lib/money.ts', 'src/deep/x.ts', 'src/a/deep/x.ts'];
        const modules = listedModuleResolution(await loadModuleAliases(files, async (p) => configs[p]), new Set(files));
        expect(resolveModuleAlias('src/page.ts', 'lib/money', modules.aliases, modules.exists)).toBe('src/lib/money');
        expect(resolveModuleAlias('src/page.ts', 'react', modules.aliases, modules.exists)).toBeNull();
        // Without knowing what exists, baseUrl is never taken (every package would become a root path).
        expect(resolveModuleAlias('src/page.ts', 'lib/money', modules.aliases)).toBeNull();
        expect(aliasCandidates('src/page.ts', '@/deep/x', modules.aliases)[0]).toBe('src/deep/x');
    });

    it('regression: a solution-style tsconfig (the Vite template) takes paths from its referenced app config; extends reaches an in-root workspace package', async () => {
        const configs: Record<string, string> = {
            'tsconfig.json': '{ "files": [], "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.app.json" }] }',
            'tsconfig.node.json': '{ "compilerOptions": { "composite": true } }',
            'tsconfig.app.json': '{ "extends": "@repo/tsconfig/base.json", "compilerOptions": { "baseUrl": "." } }',
            'node_modules/@repo/tsconfig/base.json': '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
        };
        const files = ['src/main.ts', 'src/lib/x.ts'];
        const aliases = await loadModuleAliases(files, async (p) => configs[p]);
        // The base's `paths` resolve against the app's baseUrl (`.`, the root).
        expect(resolveModuleAlias('src/main.ts', '@/lib/x', aliases)).toBe('src/lib/x');
    });

    it('end to end: the code pack extracts the rollup and buildCodeGraph lands it on the real file', () => {
        const parser = codeParser();
        const ctx = { rootId: ROOT, knownKeys: new Map(), resolvePath: resolveRelativePath };
        const doc = (id: string, text: string) => ({ id, content: { kind: 'text' as const, text }, metadata: {} });
        const extract = parser.extract!.bind(parser);
        const extracted = [extract(doc('src/service.ts', SERVICE) as never, [], ctx), extract(doc('src/repo.ts', REPO) as never, [], ctx)];
        const graph = buildCodeGraph({ rootId: ROOT, packs: [createCodePack()], extracted, facts: [], relations: [] });
        const kinds = graph.edges.filter((e) => e.from === srcRef(ROOT, 'src/service.ts')).map((e) => `${e.kind}->${e.to}`).sort();
        expect(kinds).toEqual([`calls->${srcRef(ROOT, 'src/repo.ts')}`, `composes->${srcRef(ROOT, 'src/repo.ts')}`]);
        expect(graph.nodes.some((n) => n.kind === 'missing')).toBe(false);
    });
});
