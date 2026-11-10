/**
 * knowledge/deploy/deployParser.ts — the code pack's SECOND parser (after the source-code one, which `seedCode` takes
 * as `parsers[0]`): it claims deploy descriptors ({@link descriptorKindOf}: Dockerfile, compose, wrangler, k8s,
 * Procfile, fly.toml, vercel.json, serverless.yml, package.json, GitHub workflows) before the docs pack's plain-text
 * parser would, and its `extract` emits the descriptor's `file` node (badges `deploy` = the family, `units` = how many)
 * plus its units, bindings and their edges ({@link deployGraphOf}). Per file, cached by content hash like every
 * extract, so the API, the VS Code host and the web see the same units.
 *
 * Its `parse` section — the text the index reads — is the descriptor with its VALUES redacted
 * (`redactDescriptor.ts`): keys and structure only, so no env value, var, `ARG` default or command line is indexed.
 * A descriptor over {@link MAX_DESCRIPTOR_CHARS} gives no section and no units. Pure: no I/O. Worker-safe.
 */

import { compareStr, type ExtractContext, type Extracted, type KnowledgeParser } from '@seanhogg/builderforce-memory/knowledge';
import { CONTENT_HASH_FIELD, hashText, type SourceDocument } from '@seanhogg/builderforce-memory/ingest';
import { CODE_BADGES, codeFileNode } from '../codeNodes.js';
import { lineCountOf } from '../codeFileBadges.js';
import { parseJsonc } from '../jsonc.js';
import { descriptorKindOf } from './deployModel.js';
import { DEPLOY_BADGES, deployGraphOf, isUnitRef } from './deployNodes.js';
import { MAX_DESCRIPTOR_CHARS, parseDescriptor } from './parseDescriptor.js';
import { redactDescriptorText } from './redactDescriptor.js';

/** The parser id: the code pack's, with its own suffix so a trace can tell which of the pack's parsers ran. */
export const DEPLOY_PARSER_ID = 'code:deploy';

const textOf = (source: SourceDocument): string => (source.content.kind === 'text' ? source.content.text : '');

export function deployParser(): KnowledgeParser {
    return {
        id: DEPLOY_PARSER_ID,
        accepts: (source) => source.content.kind === 'text' && descriptorKindOf(source.id) !== undefined,
        parse: (source) => {
            const text = textOf(source);
            const kind = descriptorKindOf(source.id);
            if (!kind || !text.trim() || text.length > MAX_DESCRIPTOR_CHARS) return [];
            return [{ text: redactDescriptorText(kind, source.id, text, parseJsonc), metadata: { language: kind } }];
        },
        extract(source: SourceDocument, _sections, ctx: ExtractContext): Extracted {
            const path = source.id;
            const text = textOf(source);
            const stated = source.metadata?.[CONTENT_HASH_FIELD];
            const sourceHash = typeof stated === 'string' ? stated : hashText(text);
            const parsed = parseDescriptor(path, text);
            const kind = parsed?.kind ?? '';
            const units = parsed?.units ?? [];
            const badges: Record<string, number | string> = {
                [CODE_BADGES.language]: kind, [CODE_BADGES.lines]: lineCountOf(text), [DEPLOY_BADGES.deploy]: kind, [DEPLOY_BADGES.units]: units.length,
            };
            if (parsed?.workspaces) badges[DEPLOY_BADGES.workspaces] = parsed.workspaces.join(',');
            const node = codeFileNode(ctx.rootId, path, { sourceHash, badges });
            const graph = deployGraphOf(ctx.rootId, path, units);
            // The file is found by its path; each unit by its name (the label `deployGraphOf` gave it).
            const keys = [{ ref: node.ref, key: path }, ...graph.nodes.filter((n) => isUnitRef(n.ref)).map((n) => ({ ref: n.ref, key: n.label }))];
            return {
                sourceRef: node.ref, sourceHash, nodes: [node, ...graph.nodes], edges: graph.edges,
                keys: keys.sort((a, b) => compareStr(a.key, b.key) || compareStr(a.ref, b.ref)),
            };
        },
    };
}
