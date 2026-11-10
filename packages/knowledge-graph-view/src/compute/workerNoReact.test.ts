/**
 * The compute worker must not pull React (or the r3f / DOM-only modules) into its bundle: the worker imports the task
 * builders, and a task reaching `react` through a shared module (once: `stage/tones.ts` → `scene/themeColors.ts`) ships
 * React into the worker and ties a pure task to a DOM hook file. This walks the worker entry's RUNTIME import graph
 * (type-only imports are erased and skipped) and fails on any such bare import.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FORBIDDEN = /^(react|react-dom|@react-three\/.+|three\/addons\/.+|troika-three-text)(\/.*)?$/;

function resolve(from: string, spec: string): string | null {
    const base = path.resolve(path.dirname(from), spec);
    for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
        if (existsSync(c) && !c.endsWith(path.sep) && /\.(ts|tsx)$/.test(c)) return c;
    }
    return null;
}

/** Runtime import specifiers of a module (skips `import type` / `export type`, keeps side-effect and dynamic imports). */
function importsOf(file: string): string[] {
    const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const out: string[] = [];
    for (const m of src.matchAll(/^\s*(import|export)\s+(type\s+)?([^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm)) {
        if (m[2]) continue;
        out.push(m[4]!);
    }
    for (const m of src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]!);
    return out;
}

function bareImportsReachedFrom(entry: string): Map<string, string> {
    const seen = new Set<string>(), bare = new Map<string, string>();
    const stack = [entry];
    while (stack.length) {
        const file = stack.pop()!;
        if (seen.has(file)) continue;
        seen.add(file);
        for (const spec of importsOf(file)) {
            if (spec.startsWith('.')) { const next = resolve(file, spec); if (next) stack.push(next); }
            else if (!bare.has(spec)) bare.set(spec, path.relative(HERE, file));
        }
    }
    return bare;
}

describe('the compute worker stays free of React', () => {
    it('no runtime import chain from the worker entry reaches react, react-dom, r3f or troika', () => {
        const bare = bareImportsReachedFrom(path.join(HERE, 'graphCompute.worker.ts'));
        const offenders = [...bare].filter(([spec]) => FORBIDDEN.test(spec)).map(([spec, by]) => `${spec} (from ${by})`);
        expect(offenders).toEqual([]);
        // Sanity: the walk really reached the stage task builders.
        expect(bare.has('@seanhogg/builderforce-memory/knowledge')).toBe(true);
    });
});
