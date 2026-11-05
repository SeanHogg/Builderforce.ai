/**
 * An in-memory {@link KnowledgeFs} for the code-pack tests: `files` maps an absolute,
 * `/`-separated path to its text (or `{ text, mtime }` to set its modification time; the
 * default is 1). Directories are implied by the paths; a `dirs` entry (absolute) names an
 * empty one, and a `size` override makes a file look as large as needed. A missing file
 * rejects, as a real fs does.
 */

import type { KnowledgeFs } from './fsDirectorySource.js';

export type MemoryFile = string | { text: string; mtime?: number; size?: number; kind?: 'file' | 'dir' };

const textOf = (f: MemoryFile): string => (typeof f === 'string' ? f : f.text);

export function memoryKnowledgeFs(files: Record<string, MemoryFile>, dirs: string[] = []): KnowledgeFs {
    const enc = new TextEncoder();
    return {
        async readDirectory(path) {
            const prefix = `${path.replace(/\/+$/, '')}/`;
            const out = new Map<string, 'file' | 'dir'>();
            for (const full of [...Object.keys(files), ...dirs.map((d) => `${d}/`)]) {
                if (!full.startsWith(prefix)) continue;
                const rest = full.slice(prefix.length);
                if (!rest) continue;
                const slash = rest.indexOf('/');
                if (slash < 0) {
                    const f = files[full];
                    out.set(rest, f && typeof f !== 'string' && f.kind ? f.kind : 'file');
                } else out.set(rest.slice(0, slash), 'dir');
            }
            return [...out];
        },
        async stat(path) {
            const f = files[path];
            if (f === undefined) throw new Error(`ENOENT ${path}`);
            return {
                mtime: typeof f === 'string' ? 1 : f.mtime ?? 1,
                size: typeof f === 'string' ? f.length : f.size ?? f.text.length,
            };
        },
        async readFile(path) {
            const f = files[path];
            if (f === undefined) throw new Error(`ENOENT ${path}`);
            return enc.encode(textOf(f));
        },
    };
}
