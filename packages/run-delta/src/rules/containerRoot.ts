/**
 * rules/containerRoot.ts — `container-root` (security, warn; C5.6): a Dockerfile whose final stage runs
 * as root — no `USER` after the last `FROM` (unless the base is a `:nonroot` image, e.g. distroless), or
 * `USER root` / `USER 0`. One finding per file (anchored
 * without a snippet), so moving lines keeps it and adding a non-root `USER` resolves it.
 *
 * Heuristic: a base image's own `USER` is not visible from the Dockerfile.
 */

import type { DeltaRule } from '../contract.js';
import { isDockerfilePath } from './support/configRule.js';
import type { TextView } from './support/files.js';
import { regexHits, stateSides, type Hit } from './support/stateRule.js';

const FROM = /^[ \t]*FROM[ \t]+\S/gim;
const USER = /^[ \t]*USER[ \t]+([^\s#]+)/gim;
const ROOT = /^(?:root|0)(?::(?:root|0))?$/i;
const NONROOT_BASE = /^[ \t]*FROM[ \t]+\S*[:-]nonroot\b/i;

function hitsOf(view: TextView): Hit[] {
    const froms = regexHits(FROM, view.text);
    const last = froms[froms.length - 1];
    if (!last) return [];
    const users = regexHits(USER, view.text).filter((u) => u.offset > last.offset);
    const user = users[users.length - 1];
    if (user && !ROOT.test(user.match[1]!)) return [];
    // A `:nonroot` / `-nonroot` base (distroless, Chainguard) already runs as a non-root user.
    if (!user && NONROOT_BASE.test(view.lineText(last.offset))) return [];
    const at = user ?? last;
    return [{ offset: at.offset, length: at.match[0].length, key: 'root' }];
}

export const containerRoot: DeltaRule = {
    id: 'container-root',
    version: 1,
    dimension: 'security',
    reads: ['content'],
    derive(input) {
        return stateSides(containerRoot, { files: isDockerfilePath, hits: hitsOf, severity: 'warn', granularity: 'file' }, input);
    },
};
