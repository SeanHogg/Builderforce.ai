/**
 * knowledge/facts/jsBody.ts — the `body` facts of a JS/TS file (PRD 41 §B1, §B3, §C6.1): every call with its enclosing
 * symbol, whether it is awaited and whether it runs per iteration (inside `for`/`while`/`do` — body, condition and
 * update — or a `.map`/`.forEach`/`.reduce`/`.flatMap` callback), and McCabe complexity per named function-like symbol.
 *
 * Enclosing symbols: a top-level function or const-bound function by its name, a class member as `Class.member`, a
 * named function nested in another as `outer.inner`. An anonymous callback belongs to the symbol it is written in (so its
 * calls and decisions count there). No positions: a line moved above a call never moves these facts.
 */

import type { CallFact, ComplexityFact } from '@seanhogg/builderforce-memory/knowledge';
import { calleeText, lastSegment, sameNode, type FactNode } from './factsAst.js';
import { FIELD_TYPES, fieldName } from './jsStructure.js';

/** Iterating methods whose callback runs once per element. */
export const LOOP_METHODS: ReadonlySet<string> = new Set(['map', 'forEach', 'reduce', 'flatMap']);
const LOOPS = new Set(['for_statement', 'for_in_statement', 'while_statement', 'do_statement']);
const DECISIONS = new Set(['if_statement', 'for_statement', 'for_in_statement', 'while_statement', 'do_statement', 'switch_case', 'catch_clause', 'ternary_expression']);
const LOGICAL = new Set(['&&', '||', '??']);
const FUNCTIONS = new Set(['function_declaration', 'generator_function_declaration', 'function_expression', 'function', 'generator_function', 'arrow_function', 'method_definition']);

interface Ctx { enclosing: string; inLoop: boolean; className?: string }

export interface JsBody { calls: CallFact[]; complexity: ComplexityFact[] }

const join = (outer: string, inner: string) => (outer ? `${outer}.${inner}` : inner);

export function jsBody(root: FactNode): JsBody {
    const calls = new Map<string, CallFact>();
    const complexity = new Map<string, number>();

    const call = (callee: string, ctx: Ctx, awaited: boolean) => {
        if (!callee) return;
        const key = `${ctx.enclosing}\u0000${callee}\u0000${awaited}\u0000${ctx.inLoop}`;
        const prior = calls.get(key);
        if (prior) { prior.count += 1; return; }
        calls.set(key, { callee, enclosing: ctx.enclosing, count: 1, ...(awaited ? { awaited: true } : {}), ...(ctx.inLoop ? { inLoop: true } : {}) });
    };
    const decide = (ctx: Ctx) => { if (ctx.enclosing) complexity.set(ctx.enclosing, (complexity.get(ctx.enclosing) ?? 1) + 1); };
    const enter = (name: string, ctx: Ctx): Ctx => {
        const enclosing = join(ctx.enclosing, name);
        if (!complexity.has(enclosing)) complexity.set(enclosing, 1);
        return { enclosing, inLoop: false }; // a named function's body runs when called, not per iteration of an outer loop
    };

    const visit = (n: FactNode, ctx: Ctx, awaited = false): void => {
        // Named scopes.
        if (n.type === 'class_declaration' || n.type === 'abstract_class_declaration' || n.type === 'class') {
            const name = n.childForFieldName('name')?.text;
            const inner = name ? { ...ctx, className: join(ctx.enclosing, name) } : ctx;
            for (const c of n.children) visit(c, inner);
            return;
        }
        if (n.type === 'method_definition') {
            const name = n.childForFieldName('name')?.text ?? '';
            const scoped = enter(name, { ...ctx, enclosing: ctx.className ?? ctx.enclosing });
            for (const c of n.children) visit(c, scoped);
            return;
        }
        // A class field bound to a function (`h = async () => …`) is the member `Class.h`.
        const fieldValue = FIELD_TYPES.has(n.type) ? n.childForFieldName('value') : null;
        if (fieldValue && FUNCTIONS.has(fieldValue.type) && fieldName(n)) {
            const scoped = enter(fieldName(n)!, { ...ctx, enclosing: ctx.className ?? ctx.enclosing });
            for (const c of fieldValue.children) visit(c, scoped);
            return;
        }
        if ((n.type === 'function_declaration' || n.type === 'generator_function_declaration') && n.childForFieldName('name')) {
            const scoped = enter(n.childForFieldName('name')!.text, ctx);
            for (const c of n.children) visit(c, scoped);
            return;
        }
        if (n.type === 'variable_declarator') {
            const value = n.childForFieldName('value');
            const name = n.childForFieldName('name');
            if (value && FUNCTIONS.has(value.type) && name?.type === 'identifier') {
                const scoped = enter(name.text, ctx);
                for (const c of value.children) visit(c, scoped);
                return;
            }
        }
        // Calls.
        if (n.type === 'await_expression') {
            for (const c of n.namedChildren) visit(c, ctx, true);
            return;
        }
        if (n.type === 'call_expression' || n.type === 'new_expression') {
            const fn = n.childForFieldName(n.type === 'call_expression' ? 'function' : 'constructor');
            if (fn?.type !== 'import') call(n.type === 'new_expression' ? `new ${calleeText(fn)}` : calleeText(fn), ctx, awaited);
            const loopCallback = n.type === 'call_expression' && fn?.type === 'member_expression' && LOOP_METHODS.has(lastSegment(calleeText(fn)));
            for (const c of n.children) {
                if (c.type === 'arguments' && loopCallback) {
                    for (const a of c.children) visit(a, FUNCTIONS.has(a.type) ? { ...ctx, inLoop: true } : ctx);
                    continue;
                }
                visit(c, ctx);
            }
            return;
        }
        if (n.type === 'parenthesized_expression' && awaited) { for (const c of n.namedChildren) visit(c, ctx, true); return; }
        // Decisions and loops.
        if (DECISIONS.has(n.type)) decide(ctx);
        if (n.type === 'binary_expression' && LOGICAL.has(n.childForFieldName('operator')?.text ?? '')) decide(ctx);
        if (LOOPS.has(n.type)) {
            // Everything of a loop runs per iteration (its body, a `while` / `for` condition and update) except a `for`
            // initializer and a `for…of`/`for…in` iterable, which run once.
            const once = [n.childForFieldName('initializer'), n.type === 'for_in_statement' ? n.childForFieldName('right') : null];
            for (const c of n.children) visit(c, once.some((o) => sameNode(c, o)) ? ctx : { ...ctx, inLoop: true });
            return;
        }
        for (const c of n.children) visit(c, ctx);
    };
    visit(root, { enclosing: '', inLoop: false });
    return {
        calls: [...calls.values()],
        complexity: [...complexity].map(([symbol, cyclomatic]) => ({ symbol, cyclomatic })),
    };
}

/** For the entry-point module: whether a call's arguments end in a function (the handler). */
export const isFunctionNode = (n: FactNode | undefined): boolean => !!n && FUNCTIONS.has(n.type);
