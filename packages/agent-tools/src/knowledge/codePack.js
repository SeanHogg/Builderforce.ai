/**
 * knowledge/codePack.ts — the code pack Builderforce registers on memory's knowledge graph
 * (PRD 38 §4.4–4.5). Memory owns the graph; this file supplies only what code means:
 *
 *   • parser — accepts source code (the ONE symbol extractor's language families, prose and
 *     DDL excluded); its `extract` emits the `file` node (area from memory's `/working`
 *     `areaOfPath`, language/symbol/export counts as badges), the file's exported
 *     symbols as exact keys, and the file → file rollup of its symbol-level edges
 *     (`codeRollup`: extends/implements/composes/uses/calls). No symbol nodes. Cross-file `references` cannot be seen from
 *     one file, so they come root-level from the analyzers ({@link repoGraphToExtracted});
 *   • a second parser, for deploy descriptors (`deploy/deployParser`): Dockerfile, compose, wrangler, k8s, Procfile,
 *     fly, vercel, serverless, package.json and GitHub workflows become deployable-unit entities (the 4+1 Physical view);
 *   • partitions — {@link CODE_LAYERS}, the N-layer default, overridable by
 *     `.builderforce/partitions.json` through {@link loadCodePartitions};
 *   • findings — memory's generic ones plus {@link CODE_FINDING_RULES};
 *   • analyzers — the host's `AnalyzerPort` (see `codeAnalyzers`);
 *   • judgement — none: code review stays the agent's job.
 *
 * Pure: no I/O. Worker-safe.
 */
import { compareStr, loadPartitions, normalizeKey, } from '@seanhogg/builderforce-memory/knowledge';
import { CONTENT_HASH_FIELD, hashText } from '@seanhogg/builderforce-memory/ingest';
import { extractSymbols, symbolLanguageOf } from '../symbols.js';
import { contentBadges } from './codeFileBadges.js';
import { CODE_FINDING_RULES } from './codeFindings.js';
import { fileRollup } from './codeRollup.js';
import { codeLanguageOf, isShellPath } from './codeMask.js';
import { CODE_BADGES, CODE_PACK_ID, codeFileNode } from './codeNodes.js';
import { baseOf } from './systemPaths.js';
import { descriptorKindOf } from './deploy/deployModel.js';
import { deployParser } from './deploy/deployParser.js';
/** Where a project overrides the code layers. */
export const CODE_PARTITIONS_FILE = '.builderforce/partitions.json';
/** The N-layer default (PRD 38 §4.4), generated from `codeLayers`' tables; see `buildCodeGraph` for the full folder, name and import-direction rules. */
export { CODE_LAYERS } from './codeLayers.js';
import { CODE_LAYERS } from './codeLayers.js';
/** Symbol-extractor families that are not code: prose and DDL (as the repo map excludes them). */
const NOT_CODE = new Set(['markdown', 'sql']);
/** Generated output that shares a code extension. */
const GENERATED = /\.min\.js$/i;
/** True when the code pack reads `path` (root-relative). */
export function isCodePath(path) {
    // Shell scripts are code, never docs: `[[ … ]]` in one is a test, not a wiki link.
    if (isShellPath(path))
        return true;
    const language = symbolLanguageOf(path);
    return language !== undefined && !NOT_CODE.has(language) && !GENERATED.test(path);
}
/** True when the code pack reads `path` at all: source code ({@link isCodePath}) or a deploy descriptor. THE count of the pack's files. */
export function isCodePackPath(path) {
    return isCodePath(path) || descriptorKindOf(path) !== undefined;
}
const textOf = (source) => (source.content.kind === 'text' ? source.content.text : '');
function keysOf(path, exported) {
    const base = baseOf(path);
    const keys = [path, base.toLowerCase(), normalizeKey(base.replace(/\.[^.]+$/, ''))];
    for (const name of exported)
        keys.push(name, normalizeKey(name));
    return [...new Set(keys.filter(Boolean))];
}
export function codeParser(symbolsOf = extractSymbols, modules) {
    return {
        id: CODE_PACK_ID,
        accepts: (source) => source.content.kind === 'text' && isCodePath(source.id),
        parse: (source) => {
            const text = textOf(source);
            return text.trim() ? [{ text, metadata: { language: codeLanguageOf(source.id) ?? '' } }] : [];
        },
        extract(source, _sections, ctx) {
            const path = source.id;
            const text = textOf(source);
            const stated = source.metadata?.[CONTENT_HASH_FIELD];
            const sourceHash = typeof stated === 'string' ? stated : hashText(text);
            const symbols = symbolsOf(path, text);
            const exported = [...new Set(symbols.filter((s) => s.exported).map((s) => s.name))].sort(compareStr);
            const node = codeFileNode(ctx.rootId, path, {
                sourceHash,
                badges: {
                    [CODE_BADGES.language]: codeLanguageOf(path) ?? '',
                    [CODE_BADGES.symbols]: symbols.length,
                    ...contentBadges(path, text, symbols),
                },
            });
            return {
                sourceRef: node.ref, sourceHash, nodes: [node], edges: fileRollup(ctx.rootId, path, text, ctx.resolvePath, modules),
                keys: keysOf(path, exported).map((key) => ({ ref: node.ref, key })),
            };
        },
    };
}
/**
 * The code layers: {@link CODE_LAYERS}, or a validated `.builderforce/partitions.json`
 * override. `override` is that file's content — its text or its parsed value (no fs here).
 * Throws a `TypeError` naming the first problem, as memory's `loadPartitions` does.
 */
export function loadCodePartitions(override) {
    let value = override;
    if (typeof override === 'string') {
        if (!override.trim())
            value = undefined;
        else {
            try {
                value = JSON.parse(override);
            }
            catch (e) {
                throw new TypeError(`partitions.json: not JSON (${e.message})`);
            }
        }
    }
    return loadPartitions({ id: CODE_PACK_ID, parsers: [], partitions: CODE_LAYERS }, value);
}
/**
 * The code pack. Hosts compose it BEFORE the docs pack: the first parser that accepts a
 * source wins, and the docs pack's plain-text parser accepts any text.
 */
export function createCodePack(deps = {}) {
    return {
        id: CODE_PACK_ID,
        // The source-code parser stays first (`seedCode` takes `parsers[0]`); deploy descriptors are the second.
        parsers: [codeParser(deps.symbolsOf, deps.modules), deployParser()],
        partitions: deps.partitions ?? CODE_LAYERS,
        findings: [...CODE_FINDING_RULES],
        ...(deps.analyzers ? { analyzers: deps.analyzers } : {}),
    };
}
//# sourceMappingURL=codePack.js.map