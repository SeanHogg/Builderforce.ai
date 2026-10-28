/**
 * `@builderforce/agent-tools/node-prefetch` — the Node half of PreFetch tool detection
 * (`prefetch/tools.ts`): a {@link ToolProbe} over a workspace on disk. Reads files and
 * looks the PATH up in-process — it spawns nothing (no `which`/`where`), so detection is a
 * handful of `stat`s.
 *
 * Node-only: the editor and on-prem import it; the Worker never does.
 */

import { access, readFile } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import type { ToolProbe } from './prefetch/tools.js';

/** The executable names a bin may have on this platform. */
function executableNames(bin: string): string[] {
    if (process.platform !== 'win32') return [bin];
    const exts = (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean).map((e) => e.toLowerCase());
    return [bin, ...exts.map((e) => `${bin}${e}`)];
}

const exists = (path: string): Promise<boolean> => access(path).then(() => true, () => false);

/** The probe for a workspace rooted at `root`. `env` defaults to the process's. */
export function nodeToolProbe(root: string, env: NodeJS.ProcessEnv = process.env): ToolProbe {
    const base = resolve(root);
    const inRoot = (path: string): string | undefined => {
        const abs = resolve(base, path);
        return abs === base || abs.startsWith(`${base}${process.platform === 'win32' ? '\\' : '/'}`) ? abs : undefined;
    };
    const pathDirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
    return {
        async readText(path) {
            const abs = inRoot(path);
            return abs ? readFile(abs, 'utf8').catch(() => undefined) : undefined;
        },
        async exists(path) {
            const abs = inRoot(path);
            return abs ? exists(abs) : false;
        },
        async onPath(bin) {
            if (!/^[\w.-]+$/.test(bin)) return false;
            const names = executableNames(bin);
            for (const dir of pathDirs) {
                for (const name of names) if (await exists(join(dir, name))) return true;
            }
            return false;
        },
    };
}
