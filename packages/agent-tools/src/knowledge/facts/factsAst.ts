/**
 * knowledge/facts/factsAst.ts — the syntax-tree slice the FileFacts extractors read (PRD 41 §B3), and the helpers they
 * share. Pure and Worker-safe: the node shape is structural (web-tree-sitter's nodes satisfy it), so these modules never
 * import the Node-only parser; `node-file-facts.ts` parses and hands them the root.
 */

import { sha256Hex } from '@seanhogg/builderforce-memory/knowledge';

/** The structural slice of a tree-sitter node the extractors use. */
export interface FactNode {
    readonly type: string;
    readonly text: string;
    readonly startIndex: number;
    readonly endIndex: number;
    readonly children: FactNode[];
    readonly namedChildren: FactNode[];
    childForFieldName(field: string): FactNode | null;
}

/** Resolves an import specifier written in `fromPath` to a root-relative FILE, or undefined (a package, or nothing on disk). */
export type ImportResolver = (fromPath: string, specifier: string) => string | undefined;

/**
 * Whether two handles name the same node. web-tree-sitter returns a NEW wrapper object from every accessor
 * (`childForFieldName`, `children`), so identity (`===`) never matches; type plus span does.
 */
export const sameNode = (a: FactNode | null | undefined, b: FactNode | null | undefined): boolean =>
    !!a && !!b && a.type === b.type && a.startIndex === b.startIndex && a.endIndex === b.endIndex;

/** Depth-first, pre-order; `visit` returning false skips the node's children. */
export function walk(node: FactNode, visit: (n: FactNode) => boolean | void): void {
    if (visit(node) === false) return;
    for (const c of node.children) walk(c, visit);
}

/** Whether a node has an anonymous child token of this text (`export default`, `import type`, `async def`). */
export const hasToken = (node: FactNode, token: string): boolean => node.children.some((c) => c.type === token);

/** Whitespace collapsed: the form every signature hash and expected-value hash reads. */
export const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** A short stable hash of normalized text (signatures, expected values). */
export const textHash = (text: string): string => sha256Hex(collapse(text)).slice(0, 16);

/** The value of a string literal (JS `string` / Python `string`), quotes removed; undefined for anything else. */
export function stringValue(node: FactNode | null | undefined): string | undefined {
    if (!node || node.type !== 'string') return undefined;
    const parts = node.namedChildren.filter((c) => c.type === 'string_fragment' || c.type === 'string_content' || c.type === 'escape_sequence');
    if (parts.length > 0) return parts.map((p) => p.text).join('');
    return node.text.replace(/^(['"`]{1,3})([\s\S]*)\1$/, '$2');
}

/** The callee of a call as written, with member chains flattened (`db.select`, `c.req.json`, `new Foo().bar` → `Foo().bar`). */
export function calleeText(node: FactNode | null): string {
    if (!node) return '';
    switch (node.type) {
        case 'identifier': case 'property_identifier': case 'field_identifier': case 'this': case 'super':
            return node.text;
        case 'member_expression': case 'attribute': {
            const object = node.childForFieldName('object');
            const property = node.childForFieldName('property') ?? node.childForFieldName('attribute');
            return `${calleeText(object)}.${property?.text ?? ''}`;
        }
        case 'call_expression': case 'call':
            return `${calleeText(node.childForFieldName('function'))}()`;
        case 'new_expression':
            return `${calleeText(node.childForFieldName('constructor'))}()`;
        case 'parenthesized_expression':
            return calleeText(node.namedChildren[0] ?? null);
        default:
            return collapse(node.text).slice(0, 80);
    }
}

/** The last segment of a callee (`app.post` → `post`). */
export const lastSegment = (callee: string): string => callee.slice(callee.lastIndexOf('.') + 1);

/** The arguments of a call (JS `arguments` / Python `argument_list`), named children only. */
export const argsOf = (call: FactNode): FactNode[] => call.childForFieldName('arguments')?.namedChildren ?? [];

/** Sorted, deduped strings. */
export const sortedUnique = (xs: Iterable<string>): string[] => [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
