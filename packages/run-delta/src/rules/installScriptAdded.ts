/**
 * rules/installScriptAdded.ts — `install-script-added` (security, warn; C5.4): a `package.json` in the run
 * gained an install-time lifecycle script (`preinstall`, `install`, `postinstall`, `prepare`), which runs
 * arbitrary code on every `npm install` of the package. One finding per (manifest, script), anchored
 * without the command, so editing the command keeps it and deleting the script resolves it.
 *
 * The lockfile diff, license-family change and known vulnerabilities (osv-scanner) are the L3 analyzer tier.
 */

import type { DeltaRule } from '../contract.js';
import type { TextView } from './support/files.js';
import { stateSides, type Hit } from './support/stateRule.js';

const LIFECYCLE: readonly string[] = ['preinstall', 'install', 'postinstall', 'prepare'];
const isManifest = (p: string): boolean => /(^|\/)package\.json$/.test(p);
const HUSKY_ONLY = /^(?:npx\s+)?husky(?:\s+install)?(?:\s+[\w./-]+)?(?:\s*\|\|\s*true)?$/;

function hitsOf(view: TextView): Hit[] {
    let scripts: unknown;
    try { scripts = (JSON.parse(view.text) as { scripts?: unknown }).scripts; } catch { return []; }
    if (typeof scripts !== 'object' || scripts === null) return [];
    const hits: Hit[] = [];
    for (const name of LIFECYCLE) {
        const command = (scripts as Record<string, unknown>)[name];
        if (typeof command !== 'string') continue;
        // `prepare` that only installs git hooks (husky) runs in the repo's own checkout, not in consumers'.
        if (name === 'prepare' && HUSKY_ONLY.test(command.trim())) continue;
        const offset = Math.max(0, view.text.indexOf(`"${name}"`));
        hits.push({ offset, length: name.length + 2, key: name, params: { script: name } });
    }
    return hits;
}

export const installScriptAdded: DeltaRule = {
    id: 'install-script-added',
    version: 1,
    dimension: 'security',
    reads: ['content'],
    derive(input) {
        return stateSides(installScriptAdded, { files: isManifest, hits: hitsOf, severity: 'warn', granularity: 'file' }, input);
    },
};
