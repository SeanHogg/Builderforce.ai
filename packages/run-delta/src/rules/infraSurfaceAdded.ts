/**
 * rules/infraSurfaceAdded.ts — `infra-surface-added` (security, warn; C5.6): the deploy surface grew —
 * a new Cloudflare `wrangler` route / custom domain, binding (KV, D1, R2, queue, service, …) or Durable
 * Object class, a new Dockerfile `EXPOSE` port, or a new compose `ports:` mapping. One finding per
 * (file, item), so lineage reports only what this run added; `params.kind` says which.
 */

import type { DeltaRule } from '../contract.js';
import { isComposePath, isDockerfilePath, isWranglerPath } from './support/configRule.js';
import type { TextView } from './support/files.js';
import { regexHits, stateSides, type Hit } from './support/stateRule.js';

const WRANGLER = /(?:^|[\s{,])"?(binding|pattern|route|custom_domain|class_name)"?\s*[:=]\s*"([^"\n]+)"/gm;
const WRANGLER_KIND: Readonly<Record<string, string>> = {
    binding: 'binding', pattern: 'worker-route', route: 'worker-route', custom_domain: 'worker-route', class_name: 'durable-object',
};
const EXPOSE = /^[ \t]*EXPOSE[ \t]+([^\n#]+)/gim;
const PORTS_KEY = /^(\s*)ports\s*:\s*(\[[^\]\n]*\])?\s*$/;
const LIST_ITEM = /^(\s*)-\s*["']?([^"'\s#]+)["']?/;

const item = (offset: number, length: number, kind: string, name: string): Hit => ({ offset, length, key: `${kind}:${name}`, params: { kind } });

const LONG_FIELD = /^\s*-?\s*(target|published|host_ip|protocol)\s*:\s*["']?([^"'\s#]+)["']?/;

/**
 * Compose `ports:` entries: short syntax (`- "8080:80"`, inline `[…]`) keyed by the mapping as written;
 * long syntax (`- target: 80` / `published: "8080"` on the item's following lines) keyed `<published>:<target>`
 * (or `<target>` when unpublished), so the same mapping in either syntax reads the same.
 */
function composePorts(view: TextView): Hit[] {
    const hits: Hit[] = [];
    let indent = -1;
    let offset = 0;
    let long: { offset: number; length: number; fields: Record<string, string> } | undefined;
    const flushLong = () => {
        if (long?.fields['target']) {
            const { target, published } = long.fields;
            hits.push(item(long.offset, long.length, 'port', published ? `${published}:${target}` : target!));
        }
        long = undefined;
    };
    for (const line of view.text.split('\n')) {
        const key = PORTS_KEY.exec(line);
        if (key) {
            flushLong();
            indent = key[2] ? -1 : key[1]!.length;
            for (const m of (key[2] ?? '').matchAll(/["']?([^"',\s[\]]+)["']?/g)) hits.push(item(offset, line.length, 'port', m[1]!));
        } else if (indent >= 0) {
            const li = LIST_ITEM.exec(line);
            const field = LONG_FIELD.exec(line);
            if (li && li[1]!.length > indent && field) {
                flushLong();
                long = { offset, length: line.length, fields: { [field[1]!]: field[2]! } };
            } else if (li && li[1]!.length > indent) {
                flushLong();
                hits.push(item(offset, line.length, 'port', li[2]!));
            } else if (long && field && (/^(\s*)/.exec(line)![1]!.length > indent)) {
                long.fields[field[1]!] = field[2]!;
            } else if (line.trim() !== '') {
                flushLong();
                indent = -1;
            }
        }
        offset += line.length + 1;
    }
    flushLong();
    return hits;
}

function hitsOf(view: TextView): Hit[] {
    if (isWranglerPath(view.path)) {
        return regexHits(WRANGLER, view.text).map(({ offset, match }) => item(offset, match[0].length, WRANGLER_KIND[match[1]!]!, match[2]!));
    }
    if (isDockerfilePath(view.path)) {
        return regexHits(EXPOSE, view.text).flatMap(({ offset, match }) =>
            match[1]!.trim().split(/\s+/).map((port) => item(offset, match[0].length, 'port', port)));
    }
    return composePorts(view);
}

export const infraSurfaceAdded: DeltaRule = {
    id: 'infra-surface-added',
    version: 1,
    dimension: 'security',
    reads: ['content'],
    derive(input) {
        return stateSides(infraSurfaceAdded, {
            files: (p) => isWranglerPath(p) || isDockerfilePath(p) || isComposePath(p),
            hits: hitsOf,
            severity: 'warn',
            granularity: 'file',
        }, input);
    },
};
