/**
 * incidentDependencyGraph — the blast-radius / causal-topology view of ONE incident.
 *
 * WHY THIS EXISTS. The RCA surface could show what people TYPED (the fishbone, the
 * 5-Why chain) and nothing the platform already knows. Meanwhile three tables were
 * each holding a piece of the same picture: the incident's classified
 * `affectedSystem`, the monitors pinned to that system (one of which usually raised
 * the incident), and the delivery tickets linked as implicated changes. A responder
 * asking "what else sits on this system, and has it burned us before?" had to open
 * three surfaces and hold the joins in their head.
 *
 * This module turns those rows into ONE directed graph, oriented the way causation
 * runs so the picture reads left-to-right without a legend:
 *
 *     implicated ticket ─▶ system ─▶ monitor ─▶ this incident
 *      prior incident   ─▶ system
 *
 * i.e. a change lands on a system, a monitor watching that system detects the
 * breach, the breach becomes this incident; prior incidents hang off the system as
 * its history. A system with three prior incidents and no monitor is then visible
 * as a shape, which is the entire point of drawing it.
 *
 * The builder is PURE and the loader is a thin query around it — the derivation has
 * real rules (identity by affected-system string, dedupe, node caps) and those are
 * unit-tested without a database.
 */
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { monitors, prodIncidents, prodIncidentImplicatedTasks, tasks as tasksTable } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { Db } from '../../infrastructure/database/connection';

/** What a node IS — drives its shape/colour in the chart, never its position. */
export type DependencyNodeKind = 'incident' | 'system' | 'monitor' | 'ticket';

export interface DependencyNode {
  /** Stable within one graph: `incident:<uuid>`, `system:<name>`, `monitor:<uuid>`, `ticket:<id>`. */
  id: string;
  label: string;
  kind: DependencyNodeKind;
  /** Free-form state word (`sev1`, `breached`, `done`, …) — the chart maps it to a token. */
  status?: string;
  /** True for the incident the graph was built for: the chart highlights it. */
  focus?: boolean;
}

export interface DependencyEdge {
  from: string;
  to: string;
  label?: string;
}

export interface DependencyGraphData {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}

/** The rows the builder needs, named independently of Drizzle so it stays pure. */
export interface IncidentGraphInput {
  incident: { id: string; title: string; severity: string; status: string; affectedSystem: string | null };
  /** Monitors on the same affected system (or ones that raised this incident). */
  monitors: ReadonlyArray<{ id: string; label: string; status: string; affectedSystem: string | null; currentIncidentId: string | null }>;
  /** Other incidents classified to the same system — this system's history. */
  relatedIncidents: ReadonlyArray<{ id: string; title: string; severity: string; status: string; affectedSystem: string | null }>;
  /** Delivery tickets linked as the implicated change (`prod_incident_implicated_tasks`). */
  implicatedTasks: ReadonlyArray<{ taskId: number; title: string; status: string; relation: string }>;
}

/**
 * Caps. A graph is a picture, and past ~20 nodes it stops being one — the layered
 * layout still terminates, but nothing is readable and the responder is worse off
 * than with the list they came from. The limits are applied at DERIVATION, not in
 * the component, so every renderer of this data agrees on what "the graph" is.
 */
const MAX_RELATED_INCIDENTS = 6;
const MAX_MONITORS = 8;
const MAX_TICKETS = 6;

/** The unclassified bucket — an incident with no `affectedSystem` still needs a spine. */
export const UNCLASSIFIED_SYSTEM = 'unclassified';

const systemNodeId = (system: string) => `system:${system.toLowerCase()}`;

/**
 * Derive `{nodes, edges}` for one incident.
 *
 * Systems are identified by their `affectedSystem` STRING, case-folded — that is
 * what the classifier writes and what monitors are tagged with, so two rows naming
 * "Payments" and "payments" are one node here rather than two disconnected halves
 * of the same outage.
 */
export function buildIncidentDependencyGraph(input: IncidentGraphInput): DependencyGraphData {
  const nodes: DependencyNode[] = [];
  const edges: DependencyEdge[] = [];
  const seenNodes = new Set<string>();
  const seenEdges = new Set<string>();

  const addNode = (node: DependencyNode): string => {
    if (!seenNodes.has(node.id)) { seenNodes.add(node.id); nodes.push(node); }
    return node.id;
  };
  const addEdge = (from: string, to: string, label?: string) => {
    // A self-edge is never information here (a system "caused by" itself), and a
    // duplicate would draw twice at the same coordinates.
    if (from === to) return;
    const key = `${from}->${to}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push({ from, to, ...(label ? { label } : {}) });
  };
  const addSystem = (raw: string | null | undefined): string => {
    const system = (raw ?? '').trim() || UNCLASSIFIED_SYSTEM;
    return addNode({ id: systemNodeId(system), label: system, kind: 'system' });
  };

  const incidentNode = addNode({
    id: `incident:${input.incident.id}`,
    label: input.incident.title,
    kind: 'incident',
    status: input.incident.severity,
    focus: true,
  });
  const focusSystem = addSystem(input.incident.affectedSystem);

  // The implicated change(s): what landed on the system before it broke.
  for (const ticket of input.implicatedTasks.slice(0, MAX_TICKETS)) {
    const id = addNode({ id: `ticket:${ticket.taskId}`, label: ticket.title, kind: 'ticket', status: ticket.status });
    addEdge(id, focusSystem, ticket.relation);
  }

  // Monitors: a monitor that raised THIS incident points at it directly, so the
  // detection path is visible; the rest hang off the system they watch. Both edges
  // exist for the raiser — dropping the system edge would make the monitor look
  // unrelated to the thing it watches the moment it fires.
  for (const monitor of input.monitors.slice(0, MAX_MONITORS)) {
    const id = addNode({ id: `monitor:${monitor.id}`, label: monitor.label, kind: 'monitor', status: monitor.status });
    addEdge(addSystem(monitor.affectedSystem), id, undefined);
    if (monitor.currentIncidentId === input.incident.id) addEdge(id, incidentNode, 'raised');
  }

  // This system's history. Prior incidents sit UPSTREAM of the system: they are
  // evidence about it, not consequences of this outage.
  for (const prior of input.relatedIncidents.slice(0, MAX_RELATED_INCIDENTS)) {
    if (prior.id === input.incident.id) continue;
    const id = addNode({ id: `incident:${prior.id}`, label: prior.title, kind: 'incident', status: prior.severity });
    addEdge(id, addSystem(prior.affectedSystem), 'prior');
  }

  // The spine, added LAST so it never pre-empts the more specific "raised" path but
  // is always present: the system this incident is classified to.
  addEdge(focusSystem, incidentNode, 'affects');

  return { nodes, edges };
}

/**
 * Load the rows and build the graph. Tenant-scoped at every read — an incident id is
 * a UUID, and "unguessable" is not an authorisation model.
 */
export async function loadIncidentDependencyGraph(
  db: Db,
  tenantId: number,
  incidentId: string,
): Promise<DependencyGraphData | null> {
  const [incident] = await db
    .select({
      id: prodIncidents.id,
      title: prodIncidents.title,
      severity: prodIncidents.severity,
      status: prodIncidents.status,
      affectedSystem: prodIncidents.affectedSystem,
    })
    .from(prodIncidents)
    .where(scopedToTenant(prodIncidents, tenantId, eq(prodIncidents.id, incidentId)))
    .limit(1);
  if (!incident) return null;

  const system = (incident.affectedSystem ?? '').trim();
  // Case-folded match: the classifier is an LLM and monitors are hand-tagged, so
  // "Payments" and "payments" are the same system to everyone except SQL.
  const sameSystem = system
    ? sql`lower(coalesce(${prodIncidents.affectedSystem}, '')) = ${system.toLowerCase()}`
    : sql`coalesce(${prodIncidents.affectedSystem}, '') = ''`;

  const [monitorRows, relatedRows, ticketRows] = await Promise.all([
    db
      .select({
        id: monitors.id,
        label: monitors.label,
        status: monitors.status,
        affectedSystem: monitors.affectedSystem,
        currentIncidentId: monitors.currentIncidentId,
      })
      .from(monitors)
      .where(scopedToTenant(
        monitors,
        tenantId,
        system
          ? sql`(${monitors.currentIncidentId} = ${incidentId} or lower(coalesce(${monitors.affectedSystem}, '')) = ${system.toLowerCase()})`
          : eq(monitors.currentIncidentId, incidentId),
      ))
      .orderBy(desc(monitors.lastStatusChangeAt))
      .limit(MAX_MONITORS),
    db
      .select({
        id: prodIncidents.id,
        title: prodIncidents.title,
        severity: prodIncidents.severity,
        status: prodIncidents.status,
        affectedSystem: prodIncidents.affectedSystem,
      })
      .from(prodIncidents)
      .where(scopedToTenant(prodIncidents, tenantId, and(ne(prodIncidents.id, incidentId), sameSystem)))
      .orderBy(desc(prodIncidents.startedAt))
      .limit(MAX_RELATED_INCIDENTS),
    db
      .select({
        taskId: prodIncidentImplicatedTasks.taskId,
        relation: prodIncidentImplicatedTasks.relation,
        title: tasksTable.title,
        status: tasksTable.status,
      })
      .from(prodIncidentImplicatedTasks)
      .innerJoin(tasksTable, eq(tasksTable.id, prodIncidentImplicatedTasks.taskId))
      .where(scopedToTenant(prodIncidentImplicatedTasks, tenantId, eq(prodIncidentImplicatedTasks.incidentId, incidentId)))
      .limit(MAX_TICKETS),
  ]);

  return buildIncidentDependencyGraph({
    incident,
    monitors: monitorRows,
    relatedIncidents: relatedRows,
    implicatedTasks: ticketRows,
  });
}
