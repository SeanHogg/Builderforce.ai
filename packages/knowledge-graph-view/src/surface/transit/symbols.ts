/**
 * Symbols as the drill reads them. A symbol node is `kind: 'symbol'` with the ref
 * `<file ref>#<name>`; its sort (class, function, method) comes from a badge when the pack
 * wrote one (`symbolKind`, `kind` or `type`), else from its name. A method belongs to its class
 * through a `parent` badge or a dotted name (`Class.method`). Pure.
 */

import type { KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { SymbolRecord } from '../../types';
import { fileRefOf } from '../stations';

export type SymbolSort = 'class' | 'function' | 'method';

/**
 * How many of a package's files the view names in one request: advisory, so the request stays small. The HOST's
 * cap is the only one that binds (it validates, dedupes and truncates whatever it is sent).
 */
export const SYMBOL_FILES = 200;

/**
 * The graph with the loaded definitions added as `symbol` nodes (and nothing stored): a node per record,
 * with its kind, parent, line and exported flag as badges, so `symbolSort` and `parentName` read real
 * records. Records for a ref already present are dropped.
 */
export function withSymbolRecords(graph: KnowledgeGraph, records: readonly SymbolRecord[]): KnowledgeGraph {
    if (records.length === 0) return graph;
    const have = new Set(graph.nodes.map((n) => n.ref as string));
    const nodes: KNode[] = records.filter((r) => !have.has(r.ref)).map((r) => ({
        ref: r.ref as KNode['ref'], kind: 'symbol', label: r.name, pack: 'code', importance: r.exported ? 0.6 : 0.3, origin: 'extracted',
        badges: { symbolKind: r.kind, parent: r.parent, line: r.line, exported: r.exported ? 1 : 0 },
    }));
    return { ...graph, nodes: [...graph.nodes, ...nodes] };
}

const CLASSY = /^(class|interface|type|enum|struct|trait|object)$/;
const METHODY = /^(method|member|constructor)$/;

export const isSymbol = (n: KNode): boolean => n.kind === 'symbol';

/** The part of a symbol's name after the last dot. */
export const shortName = (n: Pick<KNode, 'label'>): string => {
    const bare = n.label.replace(/\(.*$/, '');
    return bare.slice(bare.lastIndexOf('.') + 1) || bare;
};

export function symbolSort(n: KNode): SymbolSort {
    const declared = String(n.badges?.symbolKind ?? n.badges?.kind ?? n.badges?.type ?? '').toLowerCase();
    if (CLASSY.test(declared)) return 'class';
    if (METHODY.test(declared)) return 'method';
    if (declared !== '') return 'function';
    const name = n.label.replace(/\(.*$/, '');
    if (name.includes('.')) return 'method';
    return /^[A-Z]/.test(name) ? 'class' : 'function';
}

/** The class a method belongs to, by name or ref; null for a free function or a class. */
export function parentName(n: KNode): string | null {
    const declared = n.badges?.parent;
    if (declared !== undefined && String(declared) !== '') return String(declared);
    const name = n.label.replace(/\(.*$/, '');
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : null;
}

export function symbolsOf(graph: Pick<KnowledgeGraph, 'nodes'>): KNode[] {
    return graph.nodes.filter(isSymbol);
}

export function symbolsOfFile(symbols: readonly KNode[], fileRef: string): KNode[] {
    return symbols.filter((n) => fileRefOf(n.ref) === fileRef);
}

/** The methods of a class symbol: same file, naming it as their parent. */
export function membersOfClass(symbols: readonly KNode[], cls: KNode): KNode[] {
    const file = fileRefOf(cls.ref), names = new Set([cls.label, shortName(cls), cls.ref]);
    return symbols.filter((n) => n.ref !== cls.ref && fileRefOf(n.ref) === file && names.has(parentName(n) ?? '\0'));
}

const ERRORISH = /(error|exception|fail|test|spec)/i;
export const isErrorish = (n: Pick<KNode, 'label' | 'ref'>): boolean => ERRORISH.test(n.label) || /\.(test|spec)\./.test(n.ref);
