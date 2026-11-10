/**
 * knowledge/deploy/deployGraph.ts — a unit's `contains` (deploys) edges, re-pointed once every file of the root is
 * known (`buildCodeGraph`), exactly as `repointRollupEdges` does for imports: one descriptor's extract cannot know
 * whether `api/src/worker.ts` exists or which file a folder (`frontend`) or a handler module (`src/handler`) starts
 * at. The target becomes the root's file it names — itself, the module's source file (`moduleFileOf`), the folder's
 * entry (`<dir>/src/index.*`, `<dir>/index.*`, `main` / `server` / `app` / `worker` / `App`), else the folder's
 * `package.json` — and an edge that names none is dropped (memory would otherwise close it as a `missing`
 * placeholder). The unit's `source` badge keeps the folder.
 *
 * Across descriptors: a unit that deploys a FOLDER where another descriptor declares units (the CI job that runs
 * `cd api && wrangler deploy`, the image built from `frontend`) also `references` those units — the one link a single
 * descriptor's extract cannot see. Pure.
 */

import { compareStr, srcRef, type Extracted, type KEdge, type NodeRef } from '@seanhogg/builderforce-memory/knowledge';
import { moduleFileOf } from '../codeRollup.js';
import { sourcePathOf } from '../rootId.js';
import { dirOf } from '../systemPaths.js';
import { DEPLOY_EDGE_KINDS, descriptorOfUnit, isUnitRef } from './deployNodes.js';

/** Entry module names tried in a deployed folder, in order. */
const ENTRY_MODULES = ['index', 'main', 'server', 'app', 'worker', 'App'];
const OTHER_EXTS = ['.py', '.go', '.rb', '.sh'];

const moduleOrScript = (p: string, has: (p: string) => boolean): string | undefined =>
    moduleFileOf(p, has) ?? OTHER_EXTS.map((e) => p + e).find(has);

/** The root's file a deployed path names, or undefined. */
function deployedFileOf(path: string, has: (p: string) => boolean): string | undefined {
    if (path !== '' && has(path)) return path;
    if (path !== '') { const module = moduleOrScript(path, has); if (module) return module; }
    const dir = path === '' ? '' : `${path}/`;
    for (const base of [`${dir}src/`, dir]) {
        for (const name of ENTRY_MODULES) { const found = moduleOrScript(`${base}${name}`, has); if (found) return found; }
    }
    return has(`${dir}package.json`) ? `${dir}package.json` : undefined;
}

const isDeployEdge = (e: KEdge): boolean => e.kind === DEPLOY_EDGE_KINDS.deploys && isUnitRef(e.from);
const isDeclareEdge = (e: KEdge): boolean => e.kind === DEPLOY_EDGE_KINDS.declares && isUnitRef(e.to);

/** Per folder, the units descriptors in that folder declare. */
function unitsByFolder(rootId: string, extracted: readonly Extracted[]): Map<string, NodeRef[]> {
    const out = new Map<string, NodeRef[]>();
    for (const e of extracted) {
        for (const x of e.edges) {
            const path = isDeclareEdge(x) ? sourcePathOf(x.from, rootId) : undefined;
            if (path === undefined) continue;
            const list = out.get(dirOf(path)) ?? [];
            list.push(x.to);
            out.set(dirOf(path), list);
        }
    }
    for (const list of out.values()) list.sort(compareStr);
    return out;
}

/** Every unit → file edge moved onto a file of `paths` (root-relative), or dropped, plus the cross-descriptor unit links. */
export function repointDeployEdges(rootId: string, extracted: readonly Extracted[], paths: ReadonlySet<string>): Extracted[] {
    const has = (p: string): boolean => paths.has(p);
    const declared = unitsByFolder(rootId, extracted);
    return extracted.map((e) => {
        if (!e.edges.some(isDeployEdge)) return e;
        const kept = e.edges.filter((x) => !isDeployEdge(x));
        const seen = new Set<string>(kept.map((x) => `${x.from}\0${x.to}\0${x.kind}`));
        const added: KEdge[] = [];
        const push = (x: KEdge): void => {
            const key = `${x.from}\0${x.to}\0${x.kind}`;
            if (!seen.has(key)) { seen.add(key); added.push(x); }
        };
        for (const x of e.edges.filter(isDeployEdge)) {
            const written = sourcePathOf(x.to, rootId);
            if (written === undefined) continue;
            const file = deployedFileOf(written, has);
            if (file) push({ ...x, to: srcRef(rootId, file) as NodeRef });
            // Units declared beside this one (a package.json next to its wrangler.toml) are peers, not what it ships.
            if (descriptorOfUnit(x.from) !== undefined && dirOf(descriptorOfUnit(x.from)!) === written) continue;
            for (const unit of declared.get(written) ?? []) {
                push({ from: x.from, to: unit, kind: DEPLOY_EDGE_KINDS.dependsOn, weight: 1, origin: 'extracted' });
            }
        }
        return { ...e, edges: [...kept, ...added] };
    });
}
