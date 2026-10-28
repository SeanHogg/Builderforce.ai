/**
 * knowledge/codePack.ts — the code pack Builderforce registers on memory's knowledge graph
 * (PRD 38 §4.4–4.5). Memory owns the graph; this file supplies only what code means:
 *
 *   • parser — accepts source code (the ONE symbol extractor's language families, prose and
 *     DDL excluded); its `extract` emits the `file` node (area from memory's `/working`
 *     `areaOfPath`, language/symbol/export counts as badges) and the file's exported
 *     symbols as exact keys. No symbol nodes. Cross-file `references` cannot be seen from
 *     one file, so they come root-level from the analyzers ({@link repoGraphToExtracted});
 *   • partitions — {@link CODE_LAYERS}, the N-layer default, overridable by
 *     `.builderforce/partitions.json` through {@link loadCodePartitions};
 *   • findings — memory's generic ones plus {@link CODE_FINDING_RULES};
 *   • analyzers — the host's `AnalyzerPort` (see `codeAnalyzers`);
 *   • judgement — none: code review stays the agent's job.
 *
 * Pure: no I/O. Worker-safe.
 */

import {
    compareStr, loadPartitions, normalizeKey,
    type AnalyzerPort, type ExtractContext, type Extracted, type KnowledgePack, type KnowledgeParser,
    type PartitionRegistry,
} from '@seanhogg/builderforce-memory/knowledge';
import { CONTENT_HASH_FIELD, hashText, type SourceDocument } from '@seanhogg/builderforce-memory/ingest';
import { extractSymbols, symbolLanguageOf, type CodeSymbol, type SymbolLanguage } from '../symbols.js';
import { CODE_FINDING_RULES } from './codeFindings.js';
import { basenameOf, CODE_BADGES, CODE_PACK_ID, codeFileNode } from './codeNodes.js';

/** Where a project overrides the code layers. */
export const CODE_PARTITIONS_FILE = '.builderforce/partitions.json';

/** The N-layer default (PRD 38 §4.4). Order 0 is the top layer; first matching layer wins. */
export const CODE_LAYERS: PartitionRegistry = {
    partitions: [
        { id: 'presentation', order: 0, match: ['**/routes/**', '**/components/**', '**/app/**', '**/pages/**', '**/webview/**'] },
        { id: 'application', order: 1, match: ['**/application/**', '**/use-cases/**'] },
        { id: 'domain', order: 2, match: ['**/domain/**'] },
        { id: 'infrastructure', order: 3, match: ['**/infrastructure/**', '**/db/**', '**/adapters/**'] },
    ],
    allow: {
        presentation: ['application', 'domain'],
        application: ['domain'],
        domain: [],
        infrastructure: ['domain', 'application'],
    },
};

/** Symbol-extractor families that are not code: prose and DDL (as the repo map excludes them). */
const NOT_CODE: ReadonlySet<SymbolLanguage> = new Set<SymbolLanguage>(['markdown', 'sql']);
/** Generated output that shares a code extension. */
const GENERATED = /\.min\.js$/i;

/** True when the code pack reads `path` (root-relative). */
export function isCodePath(path: string): boolean {
    const language = symbolLanguageOf(path);
    return language !== undefined && !NOT_CODE.has(language) && !GENERATED.test(path);
}

/** A file's definitions. Default: the ONE regex extractor; a host with a warm index (tree-sitter) passes its own. */
export type SymbolSource = (path: string, content: string) => readonly CodeSymbol[];

const textOf = (source: SourceDocument): string => (source.content.kind === 'text' ? source.content.text : '');

function keysOf(path: string, exported: readonly string[]): string[] {
    const base = basenameOf(path);
    const keys = [path, base.toLowerCase(), normalizeKey(base.replace(/\.[^.]+$/, ''))];
    for (const name of exported) keys.push(name, normalizeKey(name));
    return [...new Set(keys.filter(Boolean))];
}

export function codeParser(symbolsOf: SymbolSource = extractSymbols): KnowledgeParser {
    return {
        id: CODE_PACK_ID,
        accepts: (source) => source.content.kind === 'text' && isCodePath(source.id),
        parse: (source) => {
            const text = textOf(source);
            return text.trim() ? [{ text, metadata: { language: symbolLanguageOf(source.id) ?? '' } }] : [];
        },
        extract(source: SourceDocument, _sections, ctx: ExtractContext): Extracted {
            const path = source.id;
            const text = textOf(source);
            const stated = source.metadata?.[CONTENT_HASH_FIELD];
            const sourceHash = typeof stated === 'string' ? stated : hashText(text);
            const symbols = symbolsOf(path, text);
            const exported = [...new Set(symbols.filter((s) => s.exported).map((s) => s.name))].sort(compareStr);
            const node = codeFileNode(ctx.rootId, path, {
                sourceHash,
                badges: {
                    [CODE_BADGES.language]: symbolLanguageOf(path) ?? '',
                    [CODE_BADGES.symbols]: symbols.length,
                    [CODE_BADGES.exports]: exported.length,
                },
            });
            return {
                sourceRef: node.ref, sourceHash, nodes: [node], edges: [],
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
export function loadCodePartitions(override?: unknown): PartitionRegistry {
    let value = override;
    if (typeof override === 'string') {
        if (!override.trim()) value = undefined;
        else {
            try { value = JSON.parse(override); } catch (e) {
                throw new TypeError(`partitions.json: not JSON (${(e as Error).message})`);
            }
        }
    }
    return loadPartitions({ id: CODE_PACK_ID, parsers: [], partitions: CODE_LAYERS }, value);
}

export interface CodePackDeps {
    /** Root-level references, cycles, clones and unused code (see `codeAnalyzers`). */
    analyzers?: AnalyzerPort;
    /** The layers; default {@link CODE_LAYERS}. Pass {@link loadCodePartitions}'s result to honour an override. */
    partitions?: PartitionRegistry;
    /** Definitions per file; default the regex extractor. */
    symbolsOf?: SymbolSource;
}

/**
 * The code pack. Hosts compose it BEFORE the docs pack: the first parser that accepts a
 * source wins, and the docs pack's plain-text parser accepts any text.
 */
export function createCodePack(deps: CodePackDeps = {}): KnowledgePack {
    return {
        id: CODE_PACK_ID,
        parsers: [codeParser(deps.symbolsOf)],
        partitions: deps.partitions ?? CODE_LAYERS,
        findings: [...CODE_FINDING_RULES],
        ...(deps.analyzers ? { analyzers: deps.analyzers } : {}),
    };
}
