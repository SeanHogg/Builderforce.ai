/**
 * Canonical-project references on the Creation Canvas.
 *
 * A canvas object points at a real tenant project by carrying
 * `resourceId: 'project:<id>'`. Publishing a site, comparing projects, attaching
 * an Evermind, seeding a canonical PRD, running a stand-up and creating a
 * Builder workspace all need the same three questions answered — which project
 * does THIS object mean, which projects are on the board, and which one is this
 * object connected to — so they are answered here once instead of by a regex
 * re-typed at every call site.
 */
import type { CreationNodeData } from '@/components/creation-canvas/types';

const PROJECT_REF = /^project:(\d+)$/;

/** Ids of the two endpoints of a canvas connection. */
interface CanvasEdgeRef { source: string; target: string }
interface CanvasNodeRef { id: string; data: CreationNodeData }

/**
 * The canonical project id an object points at, or null when it points at none.
 * Kind-agnostic on purpose: a Voice object also binds to a storage project, and
 * a Builder object's workspace lives in one.
 */
export function canvasProjectId(data: CreationNodeData): number | null {
  const match = typeof data.resourceId === 'string' ? data.resourceId.match(PROJECT_REF) : null;
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** True when the object is a canvas Project bound to a canonical tenant project. */
export function isCanonicalProjectNode(data: CreationNodeData): boolean {
  return data.kind === 'project' && canvasProjectId(data) != null;
}

/** Every canonical project on the board, in board order. */
export function canvasProjectNodes<T extends CanvasNodeRef>(nodes: readonly T[]): T[] {
  return nodes.filter((node) => isCanonicalProjectNode(node.data));
}

/**
 * The canonical project an object should act against: one it is connected to if
 * there is any, otherwise the first on the board. Falling back keeps a
 * single-project canvas working without the user having to draw an edge first.
 */
export function connectedCanvasProjectNode<T extends CanvasNodeRef>(
  nodes: readonly T[],
  edges: readonly CanvasEdgeRef[],
  nodeId: string,
): T | undefined {
  const projects = canvasProjectNodes(nodes);
  return projects.find((project) => edges.some((edge) =>
    (edge.source === nodeId && edge.target === project.id) || (edge.target === nodeId && edge.source === project.id)))
    ?? projects[0];
}
