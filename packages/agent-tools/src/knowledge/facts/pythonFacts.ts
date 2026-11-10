/**
 * knowledge/facts/pythonFacts.ts — FileFacts for a Python file (PRD 41 §B3): symbols (top-level functions and classes,
 * methods as `Class.method`), exports (the public top-level names, `__all__` when present), imports, calls (enclosing
 * symbol, awaited, in loop), complexity, decorator routes (Flask / FastAPI style) with their decorators as the guard names
 * and the modules those decorators are imported from as the (raw) guard chain, and pytest / unittest test facts.
 *
 * RAW facts: imports carry module specifiers only (`.models`, `app.models`); `resolveFileFacts` resolves them, relative
 * and absolute, against the root's listing.
 */

import type { CallFact, ComplexityFact, EntryPointFact, ExportFact, ImportFact, SymbolFact, TestCaseFact, TestFacts } from '@seanhogg/builderforce-memory/knowledge';
import { argsOf, calleeText, collapse, hasToken, lastSegment, sameNode, sortedUnique, stringValue, textHash, walk, type FactNode } from './factsAst.js';
import { chainImport } from './resolveFacts.js';

export interface PythonFacts {
    symbols: SymbolFact[];
    exports: ExportFact[];
    imports: ImportFact[];
    calls: CallFact[];
    complexity: ComplexityFact[];
    entryPoints: EntryPointFact[];
    testFacts?: TestFacts;
    /** Imported module names, for the capability table. */
    modules: string[];
}

const LOOPS = new Set(['for_statement', 'while_statement', 'list_comprehension', 'set_comprehension', 'dictionary_comprehension', 'generator_expression']);
const DECISIONS = new Set(['if_statement', 'elif_clause', 'for_statement', 'while_statement', 'except_clause', 'conditional_expression', 'boolean_operator', 'case_clause']);
const ROUTE_METHODS = new Set(['route', 'get', 'post', 'put', 'patch', 'delete', 'api_route', 'websocket']);
const INPUTS = ['request.json', 'request.form', 'request.args', 'request.data', 'request.files', 'request.headers', 'request.cookies', 'sys.argv'];

export const isPythonTestPath = (path: string): boolean => /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(path);

const signature = (fn: FactNode) => `${hasToken(fn, 'async') ? 'async ' : ''}${fn.childForFieldName('parameters')?.text ?? ''}${fn.childForFieldName('return_type')?.text ?? ''}`;
const definitionOf = (n: FactNode): FactNode => (n.type === 'decorated_definition' ? n.childForFieldName('definition') ?? n : n);
const decoratorsOf = (n: FactNode): FactNode[] => (n.type === 'decorated_definition' ? n.namedChildren.filter((c) => c.type === 'decorator') : []);

function structure(root: FactNode): Pick<PythonFacts, 'symbols' | 'exports' | 'imports' | 'modules'> & { bindings: Map<string, string> } {
    const symbols: SymbolFact[] = [];
    const imports: ImportFact[] = [];
    const modules: string[] = [];
    const bindings = new Map<string, string>();
    let dunderAll: string[] | undefined;
    for (const stmt of root.namedChildren) {
        if (stmt.type === 'import_statement') {
            for (const n of stmt.namedChildren) {
                const name = (n.type === 'aliased_import' ? n.childForFieldName('name') : n)?.text;
                if (!name) continue;
                modules.push(name);
                imports.push({ specifier: name, names: ['*'] });
                bindings.set(n.type === 'aliased_import' ? n.childForFieldName('alias')?.text ?? name : name.split('.')[0]!, name);
            }
        } else if (stmt.type === 'import_from_statement') {
            const moduleName = stmt.childForFieldName('module_name');
            const specifier = moduleName?.text ?? '';
            const names: string[] = [];
            for (const c of stmt.namedChildren.filter((x) => !sameNode(x, moduleName))) {
                const name = c.type === 'aliased_import' ? c.childForFieldName('name')?.text : c.type === 'wildcard_import' ? '*' : c.text;
                if (!name) continue;
                names.push(name);
                if (name !== '*') bindings.set(c.type === 'aliased_import' ? c.childForFieldName('alias')?.text ?? name : name, specifier);
            }
            modules.push(specifier);
            imports.push({ specifier, names });
        } else if (stmt.type === 'expression_statement' && /^__all__\s*=/.test(stmt.text)) {
            dunderAll = [];
            walk(stmt, (n) => { const v = stringValue(n); if (v !== undefined) dunderAll!.push(v); });
        }
        const def = definitionOf(stmt);
        const name = def.childForFieldName('name')?.text;
        if (!name) continue;
        if (def.type === 'function_definition') symbols.push({ name, kind: 'function', signatureHash: textHash(signature(def)) });
        if (def.type === 'class_definition') {
            const methods = (def.childForFieldName('body')?.namedChildren ?? []).map(definitionOf).filter((m) => m.type === 'function_definition');
            const publicSigs = methods.filter((m) => !(m.childForFieldName('name')?.text ?? '_').startsWith('_') || m.childForFieldName('name')?.text === '__init__')
                .map((m) => `${m.childForFieldName('name')?.text}${signature(m)}`).sort();
            symbols.push({ name, kind: 'class', signatureHash: textHash(`${def.childForFieldName('superclasses')?.text ?? ''}{${publicSigs.join(';')}}`) });
            for (const m of methods) symbols.push({ name: `${name}.${m.childForFieldName('name')?.text}`, kind: 'method', signatureHash: textHash(signature(m)) });
        }
    }
    const exported = symbols.filter((s) => !s.name.includes('.') && (dunderAll ? dunderAll.includes(s.name) : !s.name.startsWith('_')));
    return { symbols, imports, modules, bindings, exports: exported.map((s) => ({ name: s.name, kind: s.kind, signatureHash: s.signatureHash ?? '' })) };
}

function body(root: FactNode): Pick<PythonFacts, 'calls' | 'complexity'> {
    const calls = new Map<string, CallFact>();
    const complexity = new Map<string, number>();
    const visit = (n: FactNode, enclosing: string, inLoop: boolean, awaited = false): void => {
        if (n.type === 'function_definition' || n.type === 'class_definition') {
            const name = n.childForFieldName('name')?.text ?? '';
            const scope = enclosing ? `${enclosing}.${name}` : name;
            if (n.type === 'function_definition' && !complexity.has(scope)) complexity.set(scope, 1);
            for (const c of n.children) visit(c, scope, false);
            return;
        }
        if (n.type === 'await') { for (const c of n.namedChildren) visit(c, enclosing, inLoop, true); return; }
        if (n.type === 'call') {
            const callee = calleeText(n.childForFieldName('function'));
            const key = `${enclosing}\u0000${callee}\u0000${awaited}\u0000${inLoop}`;
            const prior = calls.get(key);
            if (prior) prior.count += 1;
            else calls.set(key, { callee, enclosing, count: 1, ...(awaited ? { awaited: true } : {}), ...(inLoop ? { inLoop: true } : {}) });
        }
        if (DECISIONS.has(n.type) && enclosing && complexity.has(enclosing)) complexity.set(enclosing, complexity.get(enclosing)! + 1);
        // Everything of a loop runs per iteration (body, a `while` condition) except a `for` iterable, evaluated once.
        const once = LOOPS.has(n.type) && n.type === 'for_statement' ? n.childForFieldName('right') : null;
        for (const c of n.children) visit(c, enclosing, inLoop || (LOOPS.has(n.type) && !sameNode(c, once)));
    };
    visit(root, '', false);
    return { calls: [...calls.values()], complexity: [...complexity].map(([symbol, cyclomatic]) => ({ symbol, cyclomatic })) };
}

function entryPoints(root: FactNode, bindings: ReadonlyMap<string, string>): EntryPointFact[] {
    const out: EntryPointFact[] = [];
    for (const stmt of root.namedChildren) {
        if (stmt.type !== 'decorated_definition') continue;
        const def = definitionOf(stmt);
        const decorators = decoratorsOf(stmt).map((d) => d.namedChildren[0]!).filter(Boolean);
        const route = decorators.find((d) => d.type === 'call' && ROUTE_METHODS.has(lastSegment(calleeText(d.childForFieldName('function')))));
        if (!route) continue;
        const method = lastSegment(calleeText(route.childForFieldName('function')));
        const path = stringValue(argsOf(route)[0]) ?? '';
        let verbs = method === 'route' || method === 'api_route' ? ['GET'] : [method.toUpperCase()];
        walk(route, (n) => { if (n.type === 'keyword_argument' && n.childForFieldName('name')?.text === 'methods') { verbs = []; walk(n, (s) => { const v = stringValue(s); if (v) verbs.push(v.toUpperCase()); }); } });
        const guards = sortedUnique(decorators.filter((d) => !sameNode(d, route)).map((d) => calleeText(d.type === 'call' ? d.childForFieldName('function') : d)));
        // The raw chain: the modules the guard decorators are imported from (where the binding is determinable).
        const chain = sortedUnique(guards.flatMap((g) => { const s = bindings.get(g.split('.')[0]!); return s !== undefined ? [chainImport(s)] : []; }));
        const inputs: string[] = [];
        walk(def, (n) => { if (n.type === 'attribute') { const t = calleeText(n); const hit = INPUTS.find((i) => t === i || t.startsWith(`${i}.`)); if (hit) { inputs.push(hit); return false; } } });
        for (const verb of sortedUnique(verbs)) {
            out.push({ kind: method === 'websocket' ? 'ws-handler' : 'http-route', key: `${verb} ${path}`, symbol: def.childForFieldName('name')?.text ?? '', guards, inputs: sortedUnique(inputs), chain });
        }
    }
    return out;
}

/** A test class: pytest's `Test*` naming, or a `unittest.TestCase` subclass of any name. */
const isTestClass = (def: FactNode, name: string): boolean =>
    /^Test/.test(name) || /\bTestCase\b/.test(def.childForFieldName('superclasses')?.text ?? '');

function testFacts(root: FactNode, path: string): TestFacts | undefined {
    const tests: TestCaseFact[] = [];
    let unittestClass = false;
    const visit = (n: FactNode, prefix: string[], skip: boolean) => {
        const def = definitionOf(n);
        const decorators = decoratorsOf(n).map((d) => collapse(d.text));
        const skipped = skip || decorators.some((d) => /\bskip/.test(d));
        const name = def.childForFieldName('name')?.text ?? '';
        if (def.type === 'class_definition' && isTestClass(def, name)) {
            if (!/^Test/.test(name)) unittestClass = true;
            for (const c of def.childForFieldName('body')?.namedChildren ?? []) visit(c, [...prefix, name], skipped);
            return;
        }
        if (def.type !== 'function_definition' || !name.startsWith('test')) return;
        let assertions = 0;
        const expected: string[] = [];
        walk(def, (s) => {
            if (s.type === 'assert_statement') { assertions += 1; expected.push(collapse(s.text)); }
            if (s.type === 'call' && /^self\.assert|^pytest\.raises/.test(calleeText(s.childForFieldName('function')))) { assertions += 1; expected.push(collapse(s.text)); }
        });
        tests.push({ name: [...prefix, name].join(' › '), assertions, matchers: [], ...(skipped ? { modifier: 'skip' as const } : {}), ...(expected.length ? { expectedHash: textHash(expected.join('\n')) } : {}) });
    };
    for (const stmt of root.namedChildren) visit(stmt, [], false);
    // A test file by its name, or any module holding a unittest.TestCase subclass.
    if (!isPythonTestPath(path) && !unittestClass) return undefined;
    return { framework: unittestClass && !isPythonTestPath(path) ? 'unittest' : 'pytest', tests, snapshotFiles: [] };
}

export function pythonFacts(root: FactNode, path: string): PythonFacts {
    const { bindings, ...s } = structure(root);
    const tf = testFacts(root, path);
    return { ...s, ...body(root), entryPoints: entryPoints(root, bindings), ...(tf ? { testFacts: tf } : {}) };
}
