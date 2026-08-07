/**
 * A minimal Drizzle-shaped test double.
 *
 * The growth-context services (site data, campaigns, the mcp node) are mostly
 * decision logic wrapped around a handful of queries, and that decision logic is
 * exactly what needs proving: does an unknown collection 404, does a honeypot
 * submission look identical to a success, does an ambiguous credential refuse
 * rather than guess. Standing up Postgres to assert those would test Neon, not
 * the rules.
 *
 * So: every builder method returns the same chainable object, and awaiting it
 * shifts the next queued result off a FIFO. Statements are recorded in order so
 * a test can assert not just the answer but that the right number of round-trips
 * happened. The queue is FIFO because the code under test awaits sequentially —
 * a service that fired queries concurrently would need a different double, and
 * `calls` makes that visible rather than silent.
 */

export interface FakeDbCall {
  /** `select` | `insert` | `update` | `delete` */
  kind: string;
  /** Arguments the statement head was called with. */
  args: unknown[];
  /** Chained method names, in order (`from`, `where`, `limit`, …). */
  chain: string[];
  /** Values passed to `.values()` / `.set()`, when present. */
  payload?: unknown;
  /** The argument passed to `.where()` — a Drizzle SQL object. */
  where?: unknown;
}

export interface FakeDb {
  select: (...args: unknown[]) => unknown;
  insert: (...args: unknown[]) => unknown;
  update: (...args: unknown[]) => unknown;
  delete: (...args: unknown[]) => unknown;
  execute: (...args: unknown[]) => unknown;
  /** Every statement issued, in order. */
  calls: FakeDbCall[];
  /** Results still queued — a non-empty tail means the test over-provisioned. */
  remaining: () => number;
}

/**
 * Build the double. `results` is consumed in order, one entry per awaited
 * statement; an exhausted queue yields `[]` rather than throwing, so a test that
 * only cares about the first few queries stays readable.
 */
export function fakeDb(results: Array<unknown[] | Error> = []): FakeDb {
  const queue: Array<unknown[] | Error> = [...results];
  const calls: FakeDbCall[] = [];

  const makeChain = (call: FakeDbCall): Record<string, unknown> => {
    const chain: Record<string, unknown> = {};
    const methods = [
      'from', 'where', 'limit', 'offset', 'orderBy', 'groupBy', 'having',
      'values', 'set', 'returning', 'onConflictDoNothing', 'onConflictDoUpdate',
      'leftJoin', 'innerJoin', 'for',
    ];
    for (const method of methods) {
      chain[method] = (...args: unknown[]) => {
        call.chain.push(method);
        if (method === 'values' || method === 'set') call.payload = args[0];
        if (method === 'where') call.where = args[0];
        return chain;
      };
    }
    // Thenable: awaiting the builder resolves the next queued result.
    chain.then = (
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => {
      const next = queue.shift() ?? [];
      // A queued Error means "this statement rejects" — needed to exercise the
      // paths where the DATABASE is the arbiter (a unique-index conflict the
      // service is expected to translate rather than a read it can pre-empt).
      if (next instanceof Error) return Promise.reject(next).then(resolve, reject);
      return Promise.resolve(next).then(resolve, reject);
    };
    return chain;
  };

  const head = (kind: string) => (...args: unknown[]) => {
    const call: FakeDbCall = { kind, args, chain: [] };
    calls.push(call);
    return makeChain(call);
  };

  return {
    select: head('select'),
    insert: head('insert'),
    update: head('update'),
    delete: head('delete'),
    execute: head('execute'),
    calls,
    remaining: () => queue.length,
  };
}

/**
 * Collect the COLUMN NAMES a Drizzle `where` clause references.
 *
 * Lets a test assert the real invariant — "this read is tenant-scoped" — at the
 * unit level, instead of trusting only the repo-wide ratchet. The walk is
 * cycle-guarded and depth-bounded because a Drizzle column holds a back
 * reference to its table, which holds its columns.
 */
export function whereColumns(where: unknown): string[] {
  const found = new Set<string>();
  const seen = new Set<unknown>();
  const walk = (node: unknown, depth: number): void => {
    if (!node || typeof node !== 'object' || depth > 8 || seen.has(node)) return;
    seen.add(node);
    const record = node as Record<string, unknown>;
    // A Drizzle Column carries its physical `name` plus a `table` back-reference.
    if (typeof record.name === 'string' && 'table' in record) found.add(record.name);
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) value.forEach((v) => walk(v, depth + 1));
      else walk(value, depth + 1);
    }
  };
  walk(where, 0);
  return [...found];
}

/** A `fetch` double that answers from a route table and records every request. */
export interface FakeFetch {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }>;
}

/**
 * `routes` maps a URL substring to the response to give. The FIRST matching
 * entry wins, so a test can register a specific path before a catch-all.
 */
export function fakeFetch(
  routes: Array<{ match: string; status?: number; json?: unknown; text?: string }>,
): FakeFetch {
  const calls: FakeFetch['calls'] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[k.toLowerCase()] = v;
    }
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const route = routes.find((r) => url.includes(r.match));
    if (!route) return new Response('no route', { status: 599 });
    const body = route.text ?? (route.json === undefined ? '' : JSON.stringify(route.json));
    return new Response(body, {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  impl.calls = calls;
  return impl as FakeFetch;
}
