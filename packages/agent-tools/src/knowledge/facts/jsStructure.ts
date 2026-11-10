/**
 * knowledge/facts/jsStructure.ts — the `structure` facts of a JS/TS file (PRD 41 §B1, §B3): its top-level symbols (and
 * class members, field-bound arrows included), its exports with a SIGNATURE hash (ESM and CommonJS), and its imports
 * (static, re-export, `require`, dynamic `import()`).
 *
 * RAW facts: imports carry their specifier only. Resolution against the root's listing happens where the listing is
 * known (`resolveFileFacts`), never here, so a file's facts never depend on which other files exist.
 *
 * A signature hash covers what a caller depends on — a function's parameters and return type, a class's heritage and
 * public member signatures, a type's declaration — never a body, so a body edit leaves the structure hash unchanged.
 */

import type { ExportFact, ImportFact, SymbolFact } from '@seanhogg/builderforce-memory/knowledge';
import { argsOf, calleeText, hasToken, stringValue, textHash, walk, type FactNode } from './factsAst.js';

export interface JsStructure {
    symbols: SymbolFact[];
    exports: ExportFact[];
    imports: ImportFact[];
    /** Local binding name → the import specifier it came from (ESM imports and `require` declarations), for guard chains. */
    bindings: Map<string, string>;
}

export const FUNCTION_VALUES: ReadonlySet<string> = new Set(['arrow_function', 'function_expression', 'function', 'generator_function']);
/** A class field (`h = () => …`): TS `public_field_definition` (name), JS `field_definition` (property). */
export const FIELD_TYPES: ReadonlySet<string> = new Set(['public_field_definition', 'field_definition']);
export const fieldName = (m: FactNode): string | undefined => (m.childForFieldName('name') ?? m.childForFieldName('property'))?.text;

const DECL_KIND: Record<string, string> = {
    function_declaration: 'function', generator_function_declaration: 'function', class_declaration: 'class', abstract_class_declaration: 'class',
    interface_declaration: 'interface', type_alias_declaration: 'type', enum_declaration: 'enum',
};

const isPrivate = (m: FactNode) => m.namedChildren.some((c) => c.type === 'accessibility_modifier' && c.text !== 'public');

/** What a caller depends on, as text: never a body. */
function signatureText(decl: FactNode): string {
    const part = (f: string) => decl.childForFieldName(f)?.text ?? '';
    switch (decl.type) {
        case 'function_declaration': case 'generator_function_declaration': case 'method_definition':
        case 'arrow_function': case 'function_expression': case 'function': case 'generator_function':
            return `${hasToken(decl, 'async') ? 'async ' : ''}${part('type_parameters')}${part('parameters') || part('parameter')}${part('return_type')}`;
        case 'class_declaration': case 'abstract_class_declaration': {
            const members = (decl.childForFieldName('body')?.namedChildren ?? []).filter((m) => !isPrivate(m))
                .map((m) => `${m.childForFieldName('name')?.text ?? fieldName(m) ?? ''}${m.type === 'method_definition' ? signatureText(m) : valueSignature(m)}`)
                .sort();
            const heritage = decl.namedChildren.find((c) => c.type === 'class_heritage')?.text ?? '';
            return `${part('type_parameters')}${heritage}{${members.join(';')}}`;
        }
        case 'variable_declarator': case 'public_field_definition': case 'field_definition':
            return valueSignature(decl);
        default:
            return decl.text; // interface / type alias / enum: the declaration IS the signature
    }
}

/** A bound value's signature: a function's, else its declared type, else the kind of value. */
function valueSignature(decl: FactNode): string {
    const value = decl.childForFieldName('value');
    if (value && FUNCTION_VALUES.has(value.type)) return signatureText(value);
    return decl.childForFieldName('type')?.text ?? `:${value?.type ?? 'undefined'}`;
}

/** The symbols a declaration defines: name, kind, signature hash (class methods and field-bound functions as `Class.member`). */
function declared(decl: FactNode): SymbolFact[] {
    const kind = DECL_KIND[decl.type];
    if (kind) {
        const name = decl.childForFieldName('name')?.text;
        if (!name) return [];
        const out: SymbolFact[] = [{ name, kind, signatureHash: textHash(signatureText(decl)) }];
        if (kind === 'class') {
            for (const m of decl.childForFieldName('body')?.namedChildren ?? []) {
                const value = m.childForFieldName('value');
                const member = m.type === 'method_definition' ? m.childForFieldName('name')?.text
                    : FIELD_TYPES.has(m.type) && value && FUNCTION_VALUES.has(value.type) ? fieldName(m) : undefined;
                if (member) out.push({ name: `${name}.${member}`, kind: 'method', signatureHash: textHash(signatureText(m)) });
            }
        }
        return out;
    }
    if (decl.type === 'lexical_declaration' || decl.type === 'variable_declaration') {
        return decl.namedChildren.filter((d) => d.type === 'variable_declarator' && d.childForFieldName('name')?.type === 'identifier').map((d) => {
            const value = d.childForFieldName('value');
            return { name: d.childForFieldName('name')!.text, kind: value && FUNCTION_VALUES.has(value.type) ? 'function' : 'const', signatureHash: textHash(signatureText(d)) };
        });
    }
    return [];
}

function importOf(stmt: FactNode, bindings: Map<string, string>): ImportFact | undefined {
    const specifier = stringValue(stmt.childForFieldName('source'));
    if (specifier === undefined) return undefined;
    const names: string[] = [];
    const clause = stmt.namedChildren.find((c) => c.type === 'import_clause' || c.type === 'export_clause');
    for (const c of clause?.namedChildren ?? []) {
        if (c.type === 'identifier') { names.push('default'); bindings.set(c.text, specifier); }
        if (c.type === 'namespace_import') { names.push('*'); const local = c.namedChildren[0]?.text; if (local) bindings.set(local, specifier); }
        if (c.type === 'named_imports') {
            for (const s of c.namedChildren) {
                const name = s.childForFieldName('name')?.text;
                if (!name) continue;
                names.push(name);
                bindings.set(s.childForFieldName('alias')?.text ?? name, specifier);
            }
        }
        if (c.type === 'export_specifier') { const name = c.childForFieldName('name')?.text; if (name) names.push(name); }
    }
    if (stmt.type === 'export_statement' && !clause) names.push('*');
    return { specifier, names, ...(hasToken(stmt, 'type') ? { typeOnly: true } : {}) };
}

/** `require('x')` and `import('x')` anywhere in the file; a `const x = require('y')` / `const { a } = require('y')` also binds. */
function callImports(root: FactNode, bindings: Map<string, string>): ImportFact[] {
    const out: ImportFact[] = [];
    walk(root, (n) => {
        if (n.type === 'variable_declarator') {
            const value = n.childForFieldName('value');
            const specifier = value?.type === 'call_expression' && value.childForFieldName('function')?.text === 'require' ? stringValue(argsOf(value)[0]) : undefined;
            const name = n.childForFieldName('name');
            if (specifier !== undefined && name) {
                if (name.type === 'identifier') bindings.set(name.text, specifier);
                for (const p of name.type === 'object_pattern' ? name.namedChildren : []) {
                    const local = p.type === 'pair_pattern' ? p.childForFieldName('value')?.text : p.text;
                    if (local) bindings.set(local, specifier);
                }
            }
        }
        if (n.type !== 'call_expression') return;
        const fn = n.childForFieldName('function');
        const dynamic = fn?.type === 'import';
        if (!dynamic && fn?.text !== 'require') return;
        const specifier = stringValue(argsOf(n)[0]);
        if (specifier !== undefined) out.push({ specifier, names: [], ...(dynamic ? { dynamic: true } : {}) });
    });
    return out;
}

/** CommonJS exports: `module.exports = {a, b: c}` / `= fn` (default), `exports.x = …` / `module.exports.x = …`. */
function commonJsExports(root: FactNode, local: ReadonlyMap<string, SymbolFact>): ExportFact[] {
    const out: ExportFact[] = [];
    const named = (name: string, value: FactNode | null): ExportFact => {
        const fn = !!value && FUNCTION_VALUES.has(value.type);
        const s = value?.type === 'identifier' || value?.type === 'shorthand_property_identifier' ? local.get(value.text) : undefined;
        return { name, kind: s?.kind ?? (fn ? 'function' : 'value'), signatureHash: s?.signatureHash ?? textHash(fn ? signatureText(value!) : `:${value?.type ?? 'undefined'}`) };
    };
    for (const stmt of root.namedChildren) {
        const a = stmt.type === 'expression_statement' ? stmt.namedChildren[0] : undefined;
        if (a?.type !== 'assignment_expression') continue;
        const left = calleeText(a.childForFieldName('left'));
        const right = a.childForFieldName('right');
        if (left === 'module.exports' && right?.type === 'object') {
            for (const p of right.namedChildren) {
                if (p.type === 'shorthand_property_identifier') out.push(named(p.text, p));
                if (p.type === 'pair') out.push(named(p.childForFieldName('key')?.text ?? '', p.childForFieldName('value')));
                if (p.type === 'method_definition') out.push(named(p.childForFieldName('name')?.text ?? '', p));
            }
        } else if (left === 'module.exports') out.push(named('default', right));
        else if (/^(module\.)?exports\.[\w$]+$/.test(left)) out.push(named(left.slice(left.lastIndexOf('.') + 1), right));
    }
    return out.filter((e) => e.name);
}

export function jsStructure(root: FactNode): JsStructure {
    const symbols: SymbolFact[] = [];
    const exports: ExportFact[] = [];
    const imports: ImportFact[] = [];
    const bindings = new Map<string, string>();
    const local = new Map<string, SymbolFact>();
    const pendingLocalExports: Array<{ name: string; as: string }> = [];

    for (const stmt of root.namedChildren) {
        if (stmt.type === 'import_statement') { const i = importOf(stmt, bindings); if (i) imports.push(i); continue; }
        if (stmt.type !== 'export_statement') { for (const s of declared(stmt)) { symbols.push(s); local.set(s.name, s); } continue; }

        const source = stringValue(stmt.childForFieldName('source'));
        if (source !== undefined) {
            const i = importOf(stmt, new Map());
            if (i) imports.push(i);
            const clause = stmt.namedChildren.find((c) => c.type === 'export_clause');
            const names = clause ? clause.namedChildren.map((s) => s.childForFieldName('alias')?.text ?? s.childForFieldName('name')?.text ?? '') : ['*'];
            for (const name of names.filter(Boolean)) exports.push({ name, kind: 're-export', signatureHash: textHash(`${source}#${name}`), from: source });
            continue;
        }
        const decl = stmt.childForFieldName('declaration');
        const isDefault = hasToken(stmt, 'default');
        if (decl) {
            const defined = declared(decl);
            for (const s of defined) { symbols.push(s); local.set(s.name, s); }
            for (const s of defined.filter((d) => !d.name.includes('.'))) {
                exports.push({ name: isDefault ? 'default' : s.name, kind: s.kind, signatureHash: s.signatureHash ?? '' });
            }
            continue;
        }
        const value = stmt.childForFieldName('value');
        if (isDefault && value) {
            if (value.type === 'identifier') { pendingLocalExports.push({ name: value.text, as: 'default' }); continue; }
            const fn = FUNCTION_VALUES.has(value.type);
            exports.push({ name: 'default', kind: fn ? 'function' : 'value', signatureHash: textHash(fn ? signatureText(value) : `:${value.type}`) });
            continue;
        }
        for (const s of stmt.namedChildren.find((c) => c.type === 'export_clause')?.namedChildren ?? []) {
            const name = s.childForFieldName('name')?.text;
            if (name) pendingLocalExports.push({ name, as: s.childForFieldName('alias')?.text ?? name });
        }
    }
    for (const { name, as } of pendingLocalExports) {
        const s = local.get(name);
        exports.push({ name: as, kind: s?.kind ?? 'binding', signatureHash: s?.signatureHash ?? textHash(`binding:${bindings.get(name) ?? name}`) });
    }
    imports.push(...callImports(root, bindings));
    exports.push(...commonJsExports(root, local));
    return { symbols, exports, imports, bindings };
}
