/**
 * A NESTED CANVAS, RESOLVED WHEN THE RUN IS INSTANTIATED.
 *
 * ── WHAT A `subflow` NODE IS, AND WHY IT NEVER REACHES THE EXECUTOR ──────────
 * The canvas compiler offers two bindings for nesting one canvas inside another
 * (`frontend/src/domains/workflow/domain/subflowLowering.ts`). `snapshot` inlines
 * the child at BUILD time and produces no node of this kind at all. `live` stores
 * one `subflow` node holding the child's own definition id — and this module is
 * what makes that word true: the child definition is read HERE, at the moment a
 * run is instantiated, so a child rebuilt in its own canvas reaches every parent
 * that calls it without any of them being rebuilt.
 *
 * ── WHY EXPANSION AND NOT A NESTED RUN ───────────────────────────────────────
 * The tempting shape is a node handler that starts a child `workflows` row and
 * waits on it. It would give the child its own timeline, and it would also give
 * the drain loop something it has no notion of: a task that is neither running nor
 * finished, across two runs, that has to survive approval gates, steering, retries
 * and the budget. Expanding the child's NODES into the parent's graph needs none of
 * that — one durable run, one approval surface, one place to look — and the child's
 * steps appear in the parent's timeline under the child's name, which is what
 * somebody watching actually wants to see.
 *
 * ── WHAT IT REFUSES ──────────────────────────────────────────────────────────
 * A definition it cannot read, a cycle, and depth past the limit are all ERRORS
 * that stop the run being created. A run that started with the nested part quietly
 * missing would report success for work nobody did — the same false completeness
 * the compiler refuses at build time, arriving instead at 3am on a schedule.
 *
 * Pure over a loader port: no database import, so the whole expansion is testable
 * with a Map of definitions.
 */

import type { WorkflowDefinition, WorkflowDefNode } from '../../domain/workflowGraph';

/** How deep composition may go before it is a design problem rather than a graph.
 *  The same limit the canvas enforces at build time, restated here because a
 *  definition can also arrive by API, by YAML import or from a template. */
export const MAX_SUBFLOW_DEPTH = 5;

/** Reads one workflow definition this tenant owns, or null. */
export type SubflowDefinitionLoader = (definitionId: string) => Promise<{ name: string; definition: WorkflowDefinition } | null>;

export type ExpandSubflowsResult =
  | { ok: true; definition: WorkflowDefinition; expanded: number }
  | { ok: false; error: string };

function subflowNodes(definition: WorkflowDefinition): WorkflowDefNode[] {
  return definition.nodes.filter((node) => node.kind === 'subflow');
}

function definitionIdOf(node: WorkflowDefNode): string {
  const value = node.config?.definitionId;
  return typeof value === 'string' ? value.trim() : '';
}

function nameOf(node: WorkflowDefNode): string {
  const canvas = node.config?.canvas;
  return (typeof canvas === 'string' && canvas.trim()) || node.label || 'nested canvas';
}

/**
 * A child's own trigger is that child's entry point; inlined it would be an entry
 * that can never fire, feeding steps that then wait on it forever. Dropping it
 * makes whatever it fed a root of the child, which is what the parent's edges into
 * the subflow node should feed. The same rule the canvas compiler applies when it
 * inlines a snapshot — stated twice because the two lowerings happen on different
 * sides of the wire and neither can call the other.
 */
function withoutTriggers(definition: WorkflowDefinition): WorkflowDefinition {
  const triggers = new Set(definition.nodes.filter((node) => node.kind === 'trigger').map((node) => node.id));
  if (triggers.size === 0) return definition;
  return {
    nodes: definition.nodes.filter((node) => !triggers.has(node.id)),
    edges: definition.edges.filter((edge) => !triggers.has(edge.source) && !triggers.has(edge.target)),
  };
}

/**
 * Replace every `subflow` node with the child definition it names.
 *
 * The subflow node's own id is REUSED as the child's entry (a pass-through
 * `transform`), so every edge the parent already draws into it stays valid and
 * keeps whatever outlet label it carried. A matching pass-through closes the child
 * and every edge OUT of the subflow node is re-pointed at it.
 */
export async function expandSubflows(
  definition: WorkflowDefinition,
  load: SubflowDefinitionLoader,
  /** The definitions already being expanded, outermost first. A definition that
   *  reaches itself is a cycle, and saying so is worth more than letting it fail
   *  five levels down as a depth error about a canvas nobody chose. */
  stack: readonly string[] = [],
): Promise<ExpandSubflowsResult> {
  const pending = subflowNodes(definition);
  if (pending.length === 0) return { ok: true, definition, expanded: 0 };
  if (stack.length >= MAX_SUBFLOW_DEPTH) {
    return { ok: false, error: `Nested canvases go more than ${MAX_SUBFLOW_DEPTH} deep (at "${nameOf(pending[0]!)}").` };
  }

  const nodes: WorkflowDefNode[] = [];
  /**
   * The parent's OWN edges, with anything leaving a subflow node re-pointed at that
   * child's exit. This happens before a single child edge is added, because the
   * edges added below also leave the subflow node's id — it is the child's entry —
   * and rewiring them too would hang the child's first steps off its own end.
   */
  const edges = definition.edges.map((edge) => (
    pending.some((node) => node.id === edge.source) ? { ...edge, source: `${edge.source}:exit` } : edge
  ));
  let expanded = 0;

  for (const node of definition.nodes) {
    if (node.kind !== 'subflow') { nodes.push(node); continue; }

    const definitionId = definitionIdOf(node);
    if (!definitionId) {
      return { ok: false, error: `The step "${nameOf(node)}" names a canvas that has never been built, so there is nothing to run.` };
    }
    if (stack.includes(definitionId)) {
      return { ok: false, error: `The canvas "${nameOf(node)}" runs itself, directly or through another canvas.` };
    }
    const child = await load(definitionId);
    if (!child) {
      return { ok: false, error: `The canvas "${nameOf(node)}" could not be read — it may have been deleted.` };
    }

    // Depth is counted per branch of the composition, so a flow calling two
    // canvases side by side is one level deep, not two.
    const inner = await expandSubflows(child.definition, load, [...stack, definitionId]);
    if (!inner.ok) return inner;
    expanded += 1 + inner.expanded;

    const body = withoutTriggers(inner.definition);
    if (body.nodes.length === 0) {
      return { ok: false, error: `The canvas "${nameOf(node)}" has no steps to run.` };
    }

    const scoped = (id: string) => `${node.id}~${id}`;
    const exitId = `${node.id}:exit`;
    const label = child.name || nameOf(node);

    // The child is laid out relative to ITS own top-left, then placed to the right
    // of the step that called it — so a nested graph reads beside its caller rather
    // than wherever the child canvas happened to be drawn.
    const originX = Math.min(...body.nodes.map((member) => member.position.x));
    const originY = Math.min(...body.nodes.map((member) => member.position.y));
    const width = Math.max(...body.nodes.map((member) => member.position.x)) - originX;

    nodes.push(
      { id: node.id, kind: 'transform', label: node.label, position: node.position, config: { expression: '' } },
      ...body.nodes.map((member) => ({
        ...member,
        id: scoped(member.id),
        label: `${label} · ${member.label}`,
        position: {
          x: node.position.x + 220 + (member.position.x - originX),
          y: node.position.y + (member.position.y - originY),
        },
      })),
      { id: exitId, kind: 'transform', label: `${node.label} · end`, position: { x: node.position.x + width + 440, y: node.position.y }, config: { expression: '' } },
    );

    const fed = new Set(body.edges.map((edge) => edge.target));
    const feeds = new Set(body.edges.map((edge) => edge.source));
    edges.push(
      ...body.edges.map((edge) => ({ ...edge, id: scoped(edge.id), source: scoped(edge.source), target: scoped(edge.target) })),
      ...body.nodes.filter((member) => !fed.has(member.id))
        .map((member) => ({ id: `${node.id}->${scoped(member.id)}`, source: node.id, target: scoped(member.id) })),
      ...body.nodes.filter((member) => !feeds.has(member.id))
        .map((member) => ({ id: `${scoped(member.id)}->${exitId}`, source: scoped(member.id), target: exitId })),
    );
  }

  return { ok: true, definition: { nodes, edges }, expanded };
}
