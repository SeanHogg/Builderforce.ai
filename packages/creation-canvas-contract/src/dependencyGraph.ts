/**
 * DEPENDENCY GRAPH — the one blocker→blocked analysis in the product.
 *
 * Two surfaces ask the same question at two altitudes. The PMO layer asks it of
 * INITIATIVES (`/api/pmo/rollup`, `/api/pmo/value-stream`): what blocks what,
 * where is the longest chain of unfinished work, is the graph circular. The
 * Creation Canvas asks it of the TASKS on a board, which is where the work
 * actually is — and until this module existed it could not ask at all, because
 * the canvas had no `blocks` edge and no path math to run over one.
 *
 * Rather than write the DFS twice with two status vocabularies, the math lives
 * here once and takes the vocabulary as a PREDICATE. `portfolioRollup` supplies
 * "completed/archived are done"; the canvas supplies its own task statuses. The
 * graph does not need to know which is which — open/closed, not a second branch.
 *
 * It lives beside {@link CREATION_CONNECTION_KINDS} because the canvas half of it
 * IS an edge vocabulary: `blocks` is a connection kind, and this is what a board
 * can compute once two objects are joined by one.
 *
 * WEIGHTS. The PMO layer counts hops (every initiative weighs 1). A canvas task
 * carries an estimate, so its critical path is the longest chain by ESTIMATED
 * HOURS, not by number of cards — six one-hour tasks in a row do not outrank a
 * single two-week one. Weight defaults to 1, which reproduces hop-counting
 * exactly, so the PMO caller is unchanged by the generalisation.
 */

/** A node in a dependency graph. `status` is interpreted by `isOpen`. */
export interface DependencyNode {
  id: string;
  status?: string | null;
  /** Cost of this node on a path. Defaults to 1 (hop counting). */
  weight?: number;
}

/** `fromId` BLOCKS `toId` — the arrow points the way work flows. */
export interface DependencyEdge {
  fromId: string;
  toId: string;
}

export interface DependencyAnalysis {
  /** nodeId → ids of the nodes blocking it (open and resolved alike). */
  blockedBy: Record<string, string[]>;
  /** nodeId → ids of the nodes it blocks. */
  blocks: Record<string, string[]>;
  /**
   * nodeId → true when at least one of its blockers is still OPEN. A node whose
   * blockers have all finished is not blocked, which is the distinction that
   * makes this useful on a live board rather than a static diagram.
   */
  isBlocked: Record<string, boolean>;
  /** The heaviest chain of still-open nodes, blocker-first. */
  criticalPath: string[];
  /** Total weight of {@link criticalPath}. */
  criticalPathWeight: number;
  /** True when the open sub-graph contains a cycle — the path is then unreliable. */
  cycleDetected: boolean;
}

const EMPTY: readonly string[] = [];

/**
 * Who blocks whom, which nodes are actually held up, and the heaviest chain of
 * unfinished work. Resolved nodes drop out of the path (they cannot delay
 * anything) but stay in `blockedBy`, because "this was blocked by that, and that
 * is now done" is a true and useful statement.
 *
 * Longest weighted path over a DAG by memoised DFS. A back-edge among OPEN nodes
 * sets `cycleDetected` and that branch contributes nothing further, so a circular
 * board still returns a finite answer instead of hanging.
 */
export function analyzeDependencies(
  nodes: readonly DependencyNode[],
  edges: readonly DependencyEdge[],
  isOpen: (status: string | null | undefined) => boolean,
): DependencyAnalysis {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const out = new Map<string, string[]>();
  const blockedBy: Record<string, string[]> = {};
  const blocks: Record<string, string[]> = {};
  for (const node of nodes) {
    out.set(node.id, []);
    blockedBy[node.id] = [];
    blocks[node.id] = [];
  }
  for (const edge of edges) {
    // Both endpoints must be on the board; a dangling edge is not a dependency.
    if (!byId.has(edge.fromId) || !byId.has(edge.toId)) continue;
    out.get(edge.fromId)!.push(edge.toId);
    blocks[edge.fromId]!.push(edge.toId);
    blockedBy[edge.toId]!.push(edge.fromId);
  }

  const open = (id: string): boolean => isOpen(byId.get(id)?.status);
  const weightOf = (id: string): number => {
    const weight = byId.get(id)?.weight;
    return typeof weight === 'number' && Number.isFinite(weight) && weight > 0 ? weight : 1;
  };

  const isBlocked: Record<string, boolean> = {};
  for (const node of nodes) {
    isBlocked[node.id] = (blockedBy[node.id] ?? EMPTY).some((blockerId) => open(blockerId));
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const best = new Map<string, { chain: string[]; weight: number }>();
  let cycleDetected = false;

  const walk = (id: string): { chain: string[]; weight: number } => {
    if (!open(id)) return { chain: [], weight: 0 };
    const seen = color.get(id) ?? WHITE;
    if (seen === GRAY) { cycleDetected = true; return { chain: [], weight: 0 }; }
    if (seen === BLACK) return best.get(id) ?? { chain: [id], weight: weightOf(id) };
    color.set(id, GRAY);
    let longest: { chain: string[]; weight: number } = { chain: [], weight: 0 };
    for (const next of out.get(id) ?? EMPTY) {
      const chain = walk(next);
      if (chain.weight > longest.weight) longest = chain;
    }
    color.set(id, BLACK);
    const result = { chain: [id, ...longest.chain], weight: weightOf(id) + longest.weight };
    best.set(id, result);
    return result;
  };

  let criticalPath: string[] = [];
  let criticalPathWeight = 0;
  for (const node of nodes) {
    if (!open(node.id)) continue;
    const chain = walk(node.id);
    if (chain.weight > criticalPathWeight) {
      criticalPath = chain.chain;
      criticalPathWeight = chain.weight;
    }
  }

  return { blockedBy, blocks, isBlocked, criticalPath, criticalPathWeight, cycleDetected };
}
