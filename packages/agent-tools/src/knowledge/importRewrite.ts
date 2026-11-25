/**
 * knowledge/importRewrite.ts — keeps relative specifiers pointing at the same file after files move.
 *
 * Handles `from '…'`, side-effect `import '…'`, `import('…')`, `require('…')`, `vi.mock('…'` /
 * `vi.importActual('…'` / `vi.doMock('…'` and `new URL('…', import.meta.url)`. A specifier is rewritten only when it is
 * relative (`./` or `../`) and names a file in `files`; bare packages and path aliases are left alone.
 * The specifier keeps its style (bare, `.js` or `.ts`, a directory import) and any `?query` suffix
 * (`./worker.ts?worker&url`).
 *
 * Pure: paths are root-relative with `/`, and nothing is read.
 */

const SPECIFIER = /((?:\bfrom|\bimport|\brequire|\bvi\.(?:mock|importActual|doMock)|\bnew URL)\s*\(?\s*)(['"])(\.{1,2}\/[^'"\n]*)\2/g;
const PROBE_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.mts'] as const;
const WRITTEN_EXTENSION = /\.(?:ts|tsx|mts|js|mjs)$/;
/** A written `.js` / `.mjs` names the TypeScript source beside it. */
const SOURCE_FOR_WRITTEN: Record<string, readonly string[]> = { '.js': ['.ts', '.tsx'], '.mjs': ['.mts'] };

const dirOf = (p: string): string => p.slice(0, Math.max(0, p.lastIndexOf('/')));

/** `base` joined with a relative `spec`, `.` and `..` resolved; root-relative. */
function resolveFrom(base: string, spec: string): string {
    const out = base === '' ? [] : base.split('/');
    for (const part of spec.split('/')) {
        if (part === '' || part === '.') continue;
        if (part === '..') out.pop(); else out.push(part);
    }
    return out.join('/');
}

function relativeFrom(fromDir: string, to: string): string {
    const a = fromDir === '' ? [] : fromDir.split('/');
    const b = to === '' ? [] : to.split('/');
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    const parts = [...a.slice(i).map(() => '..'), ...b.slice(i)];
    const joined = parts.join('/');
    if (joined === '') return '.';
    return joined.startsWith('..') ? joined : `./${joined}`;
}

type Style = { kind: 'file' } | { kind: 'bare' } | { kind: 'index' } | { kind: 'written'; extension: string };

/** The file `specPath` names among `files` and how it was written; undefined when it names none. */
function probe(specPath: string, files: ReadonlySet<string>): { target: string; style: Style } | undefined {
    if (files.has(specPath)) return { target: specPath, style: WRITTEN_EXTENSION.test(specPath) ? { kind: 'written', extension: specPath.slice(specPath.lastIndexOf('.')) } : { kind: 'file' } };
    const written = WRITTEN_EXTENSION.exec(specPath)?.[0];
    if (written) {
        const stem = specPath.slice(0, -written.length);
        for (const ext of SOURCE_FOR_WRITTEN[written] ?? []) if (files.has(stem + ext)) return { target: stem + ext, style: { kind: 'written', extension: written } };
    }
    for (const ext of PROBE_EXTENSIONS) if (files.has(specPath + ext)) return { target: specPath + ext, style: { kind: 'bare' } };
    for (const ext of PROBE_EXTENSIONS) if (files.has(`${specPath}/index${ext}`)) return { target: `${specPath}/index${ext}`, style: { kind: 'index' } };
    return undefined;
}

function written(target: string, style: Style): string {
    switch (style.kind) {
        case 'file': return target;
        case 'bare': return target.replace(WRITTEN_EXTENSION, '');
        case 'index': return dirOf(target);
        case 'written': return target.replace(WRITTEN_EXTENSION, '') + style.extension;
    }
}

/**
 * `text` of `file` with its relative specifiers re-pointed. `moves` maps old path → new path; `files` is every
 * file of the root before the move (what a specifier is resolved against). `changed` counts the specifiers rewritten.
 */
export function rewriteRelativeImports(file: string, text: string, moves: ReadonlyMap<string, string>, files: ReadonlySet<string>): { text: string; changed: number } {
    const oldDir = dirOf(file);
    const newDir = dirOf(moves.get(file) ?? file);
    let changed = 0;
    const out = text.replace(SPECIFIER, (whole: string, lead: string, quote: string, spec: string) => {
        const cut = spec.indexOf('?');
        const path = cut < 0 ? spec : spec.slice(0, cut);
        const query = cut < 0 ? '' : spec.slice(cut);
        const found = probe(resolveFrom(oldDir, path), files);
        if (!found) return whole;
        const next = relativeFrom(newDir, written(moves.get(found.target) ?? found.target, found.style)) + query;
        if (next === spec) return whole;
        changed++;
        return `${lead}${quote}${next}${quote}`;
    });
    return { text: out, changed };
}
