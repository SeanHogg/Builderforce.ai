/**
 * ONE pure classifier from a node's path to its file category (PRD 38 redundant encoding):
 * source / test / doc / config / style / data / other. It is the single place the view decides
 * a file's category, so the 2D graph, the 3D scene, the map and the legend all agree. Nothing
 * here touches the DOM or the graph beyond the node's `ref` (its path) and `kind`.
 *
 * Grep note: `packages/agent-tools/src/knowledge` and the memory package's `/knowledge` hold NO
 * file-category classifier (verified 2026-11-09), so this is the one copy — do not add a second.
 */

import { pathOfRef, type KNode } from '@seanhogg/builderforce-memory/knowledge';

export type FileCategory = 'source' | 'test' | 'doc' | 'config' | 'style' | 'data' | 'other';

const EXT_CATEGORY: Record<string, FileCategory> = {
    // source
    ts: 'source', tsx: 'source', js: 'source', jsx: 'source', mjs: 'source', cjs: 'source',
    py: 'source', rs: 'source', go: 'source', java: 'source', kt: 'source', swift: 'source',
    c: 'source', h: 'source', cc: 'source', cpp: 'source', cxx: 'source', hpp: 'source', cs: 'source',
    rb: 'source', php: 'source', scala: 'source', clj: 'source', ex: 'source', exs: 'source', erl: 'source',
    lua: 'source', dart: 'source', vue: 'source', svelte: 'source', sol: 'source', sh: 'source', bash: 'source',
    // doc
    md: 'doc', mdx: 'doc', markdown: 'doc', rst: 'doc', txt: 'doc', adoc: 'doc', rtf: 'doc', tex: 'doc',
    // style
    css: 'style', scss: 'style', sass: 'style', less: 'style', styl: 'style', pcss: 'style',
    // data / config-by-extension
    json: 'data', jsonc: 'data', jsonl: 'data', yaml: 'data', yml: 'data', toml: 'data', xml: 'data',
    csv: 'data', tsv: 'data', ini: 'data', env: 'data', lock: 'data', graphql: 'data', gql: 'data', proto: 'data',
    sqlite: 'data', db: 'data', dump: 'data', sql: 'data', prisma: 'data',
};

/** A migrations folder holds schema changes: data, whatever the files' extension (PRD 43 B1a rule 2). */
const MIGRATIONS_DIR = /(^|\/)migrations?(\/)/;

/** Filenames (no extension) that are config regardless of directory. */
const CONFIG_NAMES = new Set([
    'dockerfile', 'makefile', 'cmakelists.txt', 'license', 'license.md', 'license.txt', 'notice',
    '.gitignore', '.gitattributes', '.gitmodules', '.editorconfig', '.npmrc', '.nvmrc', '.node-version',
    '.eslintrc', '.prettierrc', '.babelrc', '.browserslistrc', '.dockerignore', '.eslintignore',
    '.prettierignore', '.stylelintrc', '.npmignore', '.huskyrc', '.lintstagedrc', '.browserslistrc',
]);

/** Path segments that mark a tree as generated / vendored — not source the person wrote. */
const GENERATED_SEGMENTS = new Set([
    'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.cache', 'vendor', 'third_party',
    'third-party', '__snapshots__', '.turbo', '.output', 'target', '.gradle', 'bin', 'obj',
]);

/** Test / spec conventions by extension and by path. */
const TEST_EXT = new Set(['test', 'spec', 'stories', 'cy']);
const TEST_DIR = /(^|\/)(__tests?__|test|tests|spec|specs|e2e|cypress|__mocks__|fixtures?)(\/|$)/i;
const TEST_SUFFIX = /\.(test|spec|stories|cy)\.[^/.]+$/i;

/** The file path a `src:` ref names (memory's grammar: a `#section` is not part of the path); any other ref is read as-is. */
const pathOf = (ref: string): string => pathOfRef(ref) ?? ref;

/** The lowercase final extension, or '' when there is none. */
function extOf(path: string): string {
    const base = path.slice(path.lastIndexOf('/') + 1);
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/**
 * The category of a FILE node, from its path. Non-file nodes are not classified here — callers
 * keep their own kind tone/shape for section / symbol / entity / claim / fact / missing / area.
 */
export function fileCategory(n: Pick<KNode, 'ref'>): FileCategory {
    const path = pathOf(n.ref).toLowerCase();
    const base = path.slice(path.lastIndexOf('/') + 1);

    // Generated / vendored trees read as "other" no matter what their extension says.
    if (GENERATED_SEGMENTS.has(base) || /(^|\/)node_modules\//.test(path) || /(^|\/)(dist|build|out|coverage)(\/|$)/.test(path)) {
        return 'other';
    }

    // Test / spec by directory or by filename convention (`x.test.ts`, `x.spec.tsx`, `x.cy.js`, `__tests__/x.ts`).
    if (TEST_DIR.test(path) || TEST_SUFFIX.test(base)) return 'test';
    const stem = base.slice(0, base.length - (extOf(path) ? extOf(path).length + 1 : 0));
    if (TEST_EXT.has(stem.toLowerCase())) return 'test';

    if (CONFIG_NAMES.has(base)) return 'config';
    // Dotfiles and common config basenames (`tsconfig.json`, `.eslintrc.js`, `vite.config.ts`).
    if (base.startsWith('.') || /(^|\/)((eslint|prettier|babel|vite|webpack|rollup|jest|vitest|tsconfig|jsconfig|tailwind|postcss|babel|commitlint|lint-staged)[^/]*)$/.test(base)) {
        return 'config';
    }

    if (MIGRATIONS_DIR.test(path)) return 'data';
    const ext = extOf(path);
    const byExt = EXT_CATEGORY[ext];
    if (byExt === 'data' && /(^|\/)(tsconfig|jsconfig|package|tsup|vitest|jest)\.json$/.test(base)) return 'config';
    if (byExt) return byExt;

    // Images, fonts and media with no better home.
    return 'other';
}

/** The legend keys of every category, in display order (labels.legend names each). */
export const FILE_CATEGORY_ORDER: readonly FileCategory[] = ['source', 'test', 'doc', 'config', 'style', 'data', 'other'];
