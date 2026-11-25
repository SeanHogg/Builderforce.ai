/**
 * The `/preview` harness's product data: the design mockup's `OrderService.ts` sample
 * (`.universalcode/designs/mockup-b09a5769-…html`, its CODE / CALLS / EDGES) as a real
 * `KnowledgeGraph`, the `SymbolRecord`s the code band drills with, and a
 * `KnowledgeGraphSource` over them. Pure data: it never reads the disk, so the built
 * single-file page shows exactly this and nothing of the machine it runs on.
 */

import type { CallSite, KEdge, KNode, KnowledgeGraph, NodeRef } from '@seanhogg/builderforce-memory/knowledge';
import { fixtureSource } from '../src/testing';
import type { KnowledgeGraphSource, SourceRange, SourceText, SymbolRecord } from '../src/types';

export const ORDER_ROOT = 'orders';

/** The mockup's `OrderService.ts`, line 1 first. */
export const ORDER_SOURCE: string[] = [
    "import { OrderRepository } from '../../infrastructure/orders/OrderRepository';",
    "import { PaymentGateway } from '../payments/PaymentGateway';",
    "import { EventBus } from '@acme/events';",
    "import { Order, OrderId, PlaceOrderCommand } from '../../domain/orders/Order';",
    "import { Money } from '../../domain/shared/Money';",
    "import { DomainError, EmptyOrder, TooManyItems } from '../../domain/shared/errors';",
    "",
    "/** Places and cancels orders. One reason to change: the order lifecycle. */",
    "export class OrderService {",
    "  constructor(",
    "    private readonly repo: OrderRepository,",
    "    private readonly payments: PaymentGateway,",
    "    private readonly events: EventBus,",
    "    private readonly policy = new OrderPolicy(),",
    "  ) {}",
    "",
    "  async placeOrder(cmd: PlaceOrderCommand): Promise<Order> {",
    "    this.validate(cmd);",
    "    const total = this.quote(cmd);",
    "    const charge = await this.payments.charge(cmd.customerId, total);",
    "    const order = Order.place(cmd, total, charge.id);",
    "    await this.repo.save(order);",
    "    await this.events.publish('order.placed', toReceipt(order));",
    "    return order;",
    "  }",
    "",
    "  async cancelOrder(id: OrderId): Promise<void> {",
    "    const order = await this.repo.get(id);",
    "    if (!this.policy.canCancel(order)) {",
    "      throw new OrderNotCancellable(id);",
    "    }",
    "    await this.payments.refund(order.chargeId);",
    "    order.cancel();",
    "    await this.repo.save(order);",
    "    await this.events.publish('order.cancelled', toReceipt(order));",
    "  }",
    "",
    "  private validate(cmd: PlaceOrderCommand): void {",
    "    if (cmd.items.length === 0) throw new EmptyOrder();",
    "    if (cmd.items.length > this.policy.maxItems) {",
    "      throw new TooManyItems(this.policy.maxItems);",
    "    }",
    "  }",
    "",
    "  private quote(cmd: PlaceOrderCommand): Money {",
    "    return cmd.items",
    "      .map((item) => Money.of(item.unitPrice).times(item.quantity))",
    "      .reduce(Money.sum, Money.zero());",
    "  }",
    "}",
    "",
    "export class OrderPolicy {",
    "  readonly maxItems = 50;",
    "",
    "  canCancel(order: Order): boolean {",
    "    return order.status === 'placed' && !order.shipped;",
    "  }",
    "}",
    "",
    "export class OrderNotCancellable extends DomainError {",
    "  constructor(id: OrderId) {",
    "    super(`Order ${id} can no longer be cancelled`);",
    "  }",
    "}",
    "",
    "export function toReceipt(order: Order) {",
    "  return { id: order.id, total: order.total.toString(), at: order.placedAt };",
    "}",
];

/* ---------- files and systems ---------- */

const SVC = 'application/orders/OrderService.ts';

/** Every file of the sample: its system (an area), its layer, and how central it is. */
const FILES: { id: string; path: string; system: string; partition: string; importance: number }[] = [
    { id: 'file:svc', path: SVC, system: 'application/orders', partition: 'application', importance: 1 },
    { id: 'file:ctl', path: 'application/orders/OrderController.ts', system: 'application/orders', partition: 'presentation', importance: 0.6 },
    { id: 'file:pol', path: 'application/orders/OrderPolicy.ts', system: 'application/orders', partition: 'application', importance: 0.3 },
    { id: 'file:order', path: 'domain/orders/Order.ts', system: 'domain', partition: 'domain', importance: 0.8 },
    { id: 'file:money', path: 'domain/shared/Money.ts', system: 'domain', partition: 'domain', importance: 0.7 },
    { id: 'file:errors', path: 'domain/shared/errors.ts', system: 'domain', partition: 'domain', importance: 0.4 },
    { id: 'file:repo', path: 'infrastructure/orders/OrderRepository.ts', system: 'infrastructure/orders', partition: 'infrastructure', importance: 0.6 },
    { id: 'file:pg', path: 'application/payments/PaymentGateway.ts', system: 'application/payments', partition: 'application', importance: 0.6 },
    { id: 'file:bus', path: 'node_modules/@acme/events', system: '@acme/events', partition: 'external', importance: 0.3 },
];

const SYSTEMS = [...new Set(FILES.map((f) => f.system))];

/* ---------- definitions (the mockup's NODES) ---------- */

interface Def {
    id: string;
    kind: 'class' | 'method' | 'function' | 'field' | 'external';
    name: string;
    /** A def id, or a file id for a top-level definition. */
    parent: string;
    /** 1-based, in {@link ORDER_SOURCE}; absent for definitions outside `OrderService.ts`. */
    line?: number;
    exported?: boolean;
}

const DEFS: Def[] = [
    { id: 'cls:Order', kind: 'class', name: 'Order', parent: 'file:order', exported: true },
    { id: 'cls:Money', kind: 'class', name: 'Money', parent: 'file:money', exported: true },
    { id: 'cls:DomainError', kind: 'class', name: 'DomainError', parent: 'file:errors', exported: true },
    { id: 'cls:EmptyOrder', kind: 'class', name: 'EmptyOrder', parent: 'file:errors', exported: true },
    { id: 'cls:TooManyItems', kind: 'class', name: 'TooManyItems', parent: 'file:errors', exported: true },
    { id: 'cls:Repo', kind: 'class', name: 'OrderRepository', parent: 'file:repo', exported: true },
    { id: 'cls:PG', kind: 'class', name: 'PaymentGateway', parent: 'file:pg', exported: true },
    { id: 'ext:Bus', kind: 'external', name: 'EventBus', parent: 'file:bus', exported: true },
    { id: 'cls:OrderService', kind: 'class', name: 'OrderService', parent: 'file:svc', line: 9, exported: true },
    { id: 'cls:OrderPolicy', kind: 'class', name: 'OrderPolicy', parent: 'file:svc', line: 52, exported: true },
    { id: 'cls:ONC', kind: 'class', name: 'OrderNotCancellable', parent: 'file:svc', line: 60, exported: true },
    { id: 'fn:toReceipt', kind: 'function', name: 'toReceipt', parent: 'file:svc', line: 66, exported: true },
    { id: 'm:ctor', kind: 'method', name: 'constructor', parent: 'cls:OrderService', line: 10 },
    { id: 'f:repo', kind: 'field', name: 'repo', parent: 'cls:OrderService', line: 11 },
    { id: 'f:payments', kind: 'field', name: 'payments', parent: 'cls:OrderService', line: 12 },
    { id: 'f:events', kind: 'field', name: 'events', parent: 'cls:OrderService', line: 13 },
    { id: 'f:policy', kind: 'field', name: 'policy', parent: 'cls:OrderService', line: 14 },
    { id: 'm:placeOrder', kind: 'method', name: 'placeOrder', parent: 'cls:OrderService', line: 17 },
    { id: 'm:cancelOrder', kind: 'method', name: 'cancelOrder', parent: 'cls:OrderService', line: 27 },
    { id: 'm:validate', kind: 'method', name: 'validate', parent: 'cls:OrderService', line: 38 },
    { id: 'm:quote', kind: 'method', name: 'quote', parent: 'cls:OrderService', line: 45 },
    { id: 'f:maxItems', kind: 'field', name: 'maxItems', parent: 'cls:OrderPolicy', line: 53 },
    { id: 'm:canCancel', kind: 'method', name: 'canCancel', parent: 'cls:OrderPolicy', line: 55 },
    { id: 'm:onc.ctor', kind: 'method', name: 'constructor', parent: 'cls:ONC', line: 61 },
    ...([
        ['m:PG.charge', 'charge', 'cls:PG'], ['m:PG.refund', 'refund', 'cls:PG'], ['m:Order.place', 'place', 'cls:Order'],
        ['m:Order.cancel', 'cancel', 'cls:Order'], ['m:Repo.save', 'save', 'cls:Repo'], ['m:Repo.get', 'get', 'cls:Repo'],
        ['m:Money.of', 'of', 'cls:Money'], ['m:Money.times', 'times', 'cls:Money'], ['m:Money.sum', 'sum', 'cls:Money'],
        ['m:Money.zero', 'zero', 'cls:Money'], ['m:Money.toString', 'toString', 'cls:Money'],
    ] as const).map(([id, name, parent]): Def => ({ id, kind: 'method', name, parent })),
    { id: 'm:Bus.publish', kind: 'external', name: 'publish', parent: 'ext:Bus' },
];

/** The mockup's CALLS: per caller, `[callee, line, kind?]` in call order (`reads` / `extends` when not a call). */
const CALLS: Record<string, [string, number, ('reads' | 'extends')?][]> = {
    'm:placeOrder': [['m:validate', 18], ['m:quote', 19], ['m:PG.charge', 20], ['m:Order.place', 21], ['m:Repo.save', 22], ['m:Bus.publish', 23], ['fn:toReceipt', 23]],
    'm:cancelOrder': [['m:Repo.get', 28], ['m:canCancel', 29], ['m:onc.ctor', 30], ['m:PG.refund', 32], ['m:Order.cancel', 33], ['m:Repo.save', 34], ['m:Bus.publish', 35], ['fn:toReceipt', 35]],
    'm:validate': [['cls:EmptyOrder', 39], ['f:maxItems', 40, 'reads'], ['cls:TooManyItems', 41]],
    'm:quote': [['m:Money.of', 47], ['m:Money.times', 47], ['m:Money.sum', 48], ['m:Money.zero', 48]],
    'm:canCancel': [['cls:Order', 56, 'reads']],
    'fn:toReceipt': [['m:Money.toString', 67]],
    'm:ctor': [['cls:OrderPolicy', 14]],
    'm:onc.ctor': [['cls:DomainError', 62, 'extends']],
};

/** The mockup's EDGES beyond the calls (ids from {@link DEFS} or {@link FILES}). */
const STRUCTURE: [string, string, 'calls' | 'composes' | 'extends' | 'uses'][] = [
    ['file:ctl', 'm:placeOrder', 'calls'], ['file:ctl', 'm:cancelOrder', 'calls'],
    ['f:repo', 'cls:Repo', 'composes'], ['f:payments', 'cls:PG', 'composes'], ['f:events', 'ext:Bus', 'composes'], ['f:policy', 'cls:OrderPolicy', 'composes'],
    ['cls:ONC', 'cls:DomainError', 'extends'], ['cls:EmptyOrder', 'cls:DomainError', 'extends'], ['cls:TooManyItems', 'cls:DomainError', 'extends'],
    ['m:placeOrder', 'cls:Order', 'uses'], ['m:quote', 'cls:Money', 'uses'], ['m:validate', 'f:policy', 'uses'], ['cls:Repo', 'cls:Order', 'uses'],
];

/** File-level imports (the system band's lines). */
const IMPORTS: [string, string][] = [
    ['file:ctl', 'file:svc'], ['file:svc', 'file:repo'], ['file:svc', 'file:pg'], ['file:svc', 'file:bus'], ['file:svc', 'file:order'],
    ['file:svc', 'file:money'], ['file:svc', 'file:errors'], ['file:svc', 'file:pol'], ['file:repo', 'file:order'],
];

/* ---------- refs ---------- */

const srcRef = (path: string): NodeRef => `src:${ORDER_ROOT}::${path}`;
const fileById = new Map(FILES.map((f) => [f.id, f] as const));
const defById = new Map(DEFS.map((d) => [d.id, d] as const));

function fileOf(id: string): (typeof FILES)[number] {
    for (let at: string | undefined = id; at; at = defById.get(at)?.parent) {
        const file = fileById.get(at);
        if (file) return file;
    }
    throw new Error(`orderFixture: ${id} has no file`);
}

/** `Container.name` up the def chain (files stop it), as the VS Code host qualifies a symbol. */
function qualified(d: Def): string {
    const owner = defById.get(d.parent);
    return owner ? `${qualified(owner)}.${d.name}` : d.name;
}

/** A def's ref the way the host writes it: `<file ref>#<Container.name>@<line>` (no `@line` without a line). */
const refMemo = new Map<string, string>();
function refOf(id: string): NodeRef {
    const file = fileById.get(id);
    if (file) return srcRef(file.path);
    const d = defById.get(id);
    if (!d) throw new Error(`orderFixture: unknown id ${id}`);
    const known = refMemo.get(id);
    if (known) return known as NodeRef;
    const ref = `${srcRef(fileOf(id).path)}#${qualified(d)}${d.line ? `@${d.line}` : ''}`;
    refMemo.set(id, ref);
    return ref as NodeRef;
}

/** Where in its line a call to `callee` is written (1-based; 1 when the name is not on the line). */
function columnOf(line: number, callee: string): number {
    const at = (ORDER_SOURCE[line - 1] ?? '').indexOf(defById.get(callee)?.name ?? '');
    return at >= 0 ? at + 1 : 1;
}

function sitesOf(caller: string, callee: string): CallSite[] {
    const list = CALLS[caller] ?? [];
    return list.flatMap(([to, line], order) => (to === callee ? [{ path: SVC, line, column: columnOf(line, to), order }] : []));
}

/* ---------- the graph ---------- */

const graphKind = (k: Def['kind']): string => (k === 'field' ? 'symbol' : k);

export function orderGraph(): KnowledgeGraph {
    const areas: KNode[] = SYSTEMS.map((system) => ({
        ref: srcRef(`area/${system}`), kind: 'area', label: system, pack: 'code', importance: FILES.filter((f) => f.system === system).length / FILES.length, origin: 'extracted',
    }));
    const files: KNode[] = FILES.map((f) => ({
        ref: srcRef(f.path), kind: 'file', label: f.path.slice(f.path.lastIndexOf('/') + 1), pack: 'code', partition: f.partition,
        area: srcRef(`area/${f.system}`), system: '', importance: f.importance, origin: 'extracted', sourceHash: `h:${f.path}`,
    }));
    // `line` rides on the node itself: the code dock's `recordsForCode` reads it there when no symbols are loaded yet.
    const defs: KNode[] = DEFS.map((d) => ({
        ref: refOf(d.id), kind: graphKind(d.kind), label: d.name, pack: 'code', partition: fileOf(d.id).partition,
        importance: d.line ? 0.5 : 0.2, origin: 'extracted', ...(d.line ? { line: d.line } : {}),
    }) as KNode);

    const edges: KEdge[] = [];
    const seen = new Set<string>();
    const add = (from: string, to: string, kind: string, extra: Partial<KEdge> = {}): void => {
        const key = `${from}\0${to}\0${kind}`;
        if (seen.has(key)) return;
        seen.add(key);
        edges.push({ from: refOf(from), to: refOf(to), kind, weight: 1, origin: 'extracted', ...extra });
    };
    for (const [caller, list] of Object.entries(CALLS)) {
        for (const [callee, , how] of list) {
            if (how === 'reads') add(caller, callee, 'uses');
            else if (how === 'extends') add(caller, callee, 'extends');
            else add(caller, callee, 'calls', { sites: sitesOf(caller, callee) });
        }
    }
    for (const [from, to, kind] of STRUCTURE) add(from, to, kind);
    for (const [from, to] of IMPORTS) add(from, to, 'references', { verdict: 'allowed' });

    const nodes = [...areas, ...files, ...defs];
    return {
        scope: { rootId: ORDER_ROOT, packs: ['code'], digest: `d:${ORDER_ROOT}` }, nodes, edges, findings: [],
        stats: { sources: files.length, nodes: nodes.length, edges: edges.length, stale: 0, truncated: false },
    };
}

/* ---------- the symbols the code band drills with ---------- */

const RELATION_KIND = { reads: 'reads', extends: 'extends' } as const;

export function orderSymbols(): SymbolRecord[] {
    return DEFS.filter((d) => d.line !== undefined).map((d) => {
        const relations = new Map<string, { kind: string; to: string; sites?: CallSite[] }>();
        for (const [callee, , how] of CALLS[d.id] ?? []) {
            const kind = how ? RELATION_KIND[how] : 'calls';
            const key = `${kind}\0${callee}`;
            if (relations.has(key)) continue;
            relations.set(key, { kind, to: refOf(callee), ...(kind === 'calls' ? { sites: sitesOf(d.id, callee) } : {}) });
        }
        const parent = defById.has(d.parent) ? refOf(d.parent) : srcRef(fileOf(d.id).path);
        return {
            ref: refOf(d.id), name: d.name, kind: d.kind, parent, line: d.line!, exported: d.exported ?? false,
            ...(relations.size > 0 ? { relations: [...relations.values()] } : {}),
        };
    });
}

/* ---------- the source ---------- */

/** `range` of `OrderService.ts` (the only file whose text the sample has), from line 1 at the earliest. */
function readOrder(range: SourceRange): SourceText {
    const startLine = Math.max(1, range.startLine);
    return { startLine, lines: ORDER_SOURCE.slice(startLine - 1, Math.max(startLine - 1, range.endLine)), truncated: false };
}

export function orderSource(): KnowledgeGraphSource {
    return {
        ...fixtureSource([orderGraph()]),
        symbolsOf: async () => orderSymbols(),
        readSource: async (_rootId, path, range) => (path === SVC ? readOrder(range) : null),
    };
}
