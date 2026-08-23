/**
 * OUTLETS — what a step's decision looks like as connection points.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────
 * A `router`/`switch`/`branch` step has always been able to take one of several
 * paths at runtime: the executor tags the payload with `$route`/`$branch` and
 * PRUNES any downstream arm whose edge carries a different outlet label (see
 * `WorkflowDefEdge.label`). But nothing on any authoring surface drew those
 * paths. A switch had one connection point like every other card, its cases were
 * a JSON textarea, and the only way to express "this case goes there" was to hand
 * every arm a `filter` step reading `$route == "Name"`. So a board that plainly
 * read "if paid → charge, else → email" wired both arms to the same dot and the
 * author had to trust a convention nothing on screen showed.
 *
 * An outlet is that missing thing: one named, individually connectable point per
 * decision path, rendered along the BOTTOM of the card (the top/left/right points
 * stay the unconditional in/out), and carried onto the edge as its label so the
 * executor prunes exactly the arm the author drew.
 *
 * ── WHY THE CONFIG IS THE TRUTH AND OUTLETS ARE DERIVED ──────────────────────
 * The executor reads `config.routes` / `config.cases` / `config.fallback`. If an
 * authored outlet list were ALSO stored, the two could disagree — and the one
 * that decides at runtime is the one nobody was looking at. So there is exactly
 * one stored representation (the config the executor already reads), this module
 * projects it into outlets for the handles and the editor, and
 * {@link writeStepOutlets} folds an edited outlet list back into that same
 * config. Nothing else in the codebase parses `routes`/`cases`.
 *
 * ── WHY IDS ARE POSITIONAL ───────────────────────────────────────────────────
 * A handle id has to survive a rename, or renaming "Then" to "Paid" would silently
 * detach every edge leaving it. `outlet:0` is stable across renames and across
 * edits to the condition; only REORDERING moves an edge, which is why the editor
 * offers add/remove/rename and not drag-to-reorder. The fallback is `outlet:else`
 * — a name, not a position, because it is always the last resort whatever it is
 * called.
 *
 * Pure data + pure functions: no React, no config panel, no canvas. The card that
 * draws the handles, the inspector that edits the conditions and the compiler that
 * lowers the board all answer this one module rather than each parsing the JSON.
 */

import type { WorkflowNodeKind } from '@/lib/builderforceApi';

/** One named path out of a step. */
export interface FlowOutlet {
  /** Handle id — stable across renames. See the header. */
  id: string;
  /** The label carried onto the edge, and what the executor matches on. */
  name: string;
  /** Boolean expression selecting this outlet (`router`). */
  condition?: string;
  /** Literal value selecting this outlet (`switch`). */
  match?: string;
  /** Taken when nothing else matched. */
  fallback?: boolean;
}

/** Which predicate an outlet of this kind carries — what the editor must ask for. */
export type OutletPredicate = 'condition' | 'match' | 'none';

/** The id of the single unconditional outlet every other kind has. */
export const DEFAULT_OUTLET_ID = 'out';
/** The id of the "nothing matched" outlet. */
export const FALLBACK_OUTLET_ID = 'outlet:else';

const OUTLET_PREDICATE: Partial<Record<WorkflowNodeKind, OutletPredicate>> = {
  router: 'condition',
  switch: 'match',
  branch: 'none',
};

/** Whether this kind decides between several named paths. */
export function isMultiOutletKind(kind: WorkflowNodeKind): boolean {
  return kind in OUTLET_PREDICATE;
}

/** What the editor asks the author for on each outlet of this kind. */
export function outletPredicate(kind: WorkflowNodeKind): OutletPredicate {
  return OUTLET_PREDICATE[kind] ?? 'none';
}

/** Read a JSON-encoded config array, tolerating the already-parsed form. */
function readArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
  } catch {
    // A half-typed textarea is the normal state of one being edited — an outlet
    // list that vanishes mid-keystroke would be worse than one that waits.
    return [];
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The outlets of one step, in the order the executor evaluates them.
 *
 * Every kind has at least one: a step with no decision to make still has to be
 * connectable, and giving it the same shape as a router means the card, the
 * inspector and the compiler never special-case "the ordinary case".
 */
export function stepOutlets(kind: WorkflowNodeKind, config: Record<string, unknown> = {}): FlowOutlet[] {
  if (kind === 'branch') {
    // Fixed pair, not authored: the executor tags `$branch` with exactly these two
    // strings, so offering "add an outlet" here would draw a path that can never
    // be taken.
    return [
      { id: 'outlet:true', name: 'true' },
      { id: 'outlet:false', name: 'false' },
    ];
  }
  if (kind === 'router') {
    const routes = readArray(config.routes).map((route, index) => ({
      id: `outlet:${index}`,
      name: text(route.name) || `Route ${index + 1}`,
      condition: text(route.condition),
    }));
    return [...routes, fallbackOutlet(config)];
  }
  if (kind === 'switch') {
    const cases = readArray(config.cases).map((entry, index) => ({
      id: `outlet:${index}`,
      name: text(entry.name) || text(entry.match) || `Case ${index + 1}`,
      match: text(entry.match),
    }));
    return [...cases, fallbackOutlet(config)];
  }
  return [{ id: DEFAULT_OUTLET_ID, name: '' }];
}

function fallbackOutlet(config: Record<string, unknown>): FlowOutlet {
  return { id: FALLBACK_OUTLET_ID, name: text(config.fallback) || 'Else', fallback: true };
}

/**
 * Fold an edited outlet list back into the config the executor reads.
 *
 * Returns a PATCH, not a whole config, so a caller merges it the same way every
 * other config edit is merged.
 */
export function writeStepOutlets(kind: WorkflowNodeKind, outlets: readonly FlowOutlet[]): Record<string, unknown> {
  const fallback = outlets.find((outlet) => outlet.fallback);
  const branchable = outlets.filter((outlet) => !outlet.fallback);
  if (kind === 'router') {
    return {
      routes: JSON.stringify(branchable.map((outlet) => ({ name: outlet.name, condition: outlet.condition ?? '' }))),
      fallback: fallback?.name ?? 'Else',
    };
  }
  if (kind === 'switch') {
    return {
      cases: JSON.stringify(branchable.map((outlet) => ({ match: outlet.match ?? '', name: outlet.name }))),
      fallback: fallback?.name ?? 'Else',
    };
  }
  // `branch` and every single-outlet kind have nothing authorable to write back.
  return {};
}

/** The config patch that appends one more named path. */
export function appendOutlet(kind: WorkflowNodeKind, config: Record<string, unknown>): Record<string, unknown> {
  const outlets = stepOutlets(kind, config);
  const authored = outlets.filter((outlet) => !outlet.fallback);
  const next: FlowOutlet = {
    id: `outlet:${authored.length}`,
    name: kind === 'switch' ? `Case ${authored.length + 1}` : `Route ${authored.length + 1}`,
    ...(kind === 'switch' ? { match: '' } : { condition: '' }),
  };
  return writeStepOutlets(kind, [...authored, next, ...outlets.filter((outlet) => outlet.fallback)]);
}

/** The config patch that drops one named path. The fallback cannot be dropped —
 *  a decision with nowhere to go when nothing matches is a dead end, not a graph. */
export function removeOutlet(kind: WorkflowNodeKind, config: Record<string, unknown>, outletId: string): Record<string, unknown> {
  const outlets = stepOutlets(kind, config).filter((outlet) => outlet.fallback || outlet.id !== outletId);
  return writeStepOutlets(kind, outlets);
}

/** The config patch that edits one named path in place. */
export function patchOutlet(
  kind: WorkflowNodeKind,
  config: Record<string, unknown>,
  outletId: string,
  patch: Partial<FlowOutlet>,
): Record<string, unknown> {
  const outlets = stepOutlets(kind, config).map((outlet) => (outlet.id === outletId ? { ...outlet, ...patch } : outlet));
  return writeStepOutlets(kind, outlets);
}

/**
 * The outlet an edge leaves from, resolved from the handle it is attached to.
 *
 * Positional rather than by name (see the header): an edge drawn from outlet 0
 * keeps leaving outlet 0 after the author renames it, and the label it carries
 * follows the rename instead of pointing at a path that no longer exists.
 */
export function outletForHandle(
  kind: WorkflowNodeKind,
  config: Record<string, unknown>,
  handleId: string | null | undefined,
): FlowOutlet | null {
  if (!handleId) return null;
  return stepOutlets(kind, config).find((outlet) => outlet.id === handleId) ?? null;
}
