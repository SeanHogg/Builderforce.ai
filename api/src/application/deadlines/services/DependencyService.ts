import type { DeadlineRepository } from '../../infrastructure/repositories/DeadlineRepository.js';

/**
 * Timelines-and-deadlines dependency engine.
 *
 * Builds the schedule graph, detects cycles, and propagates health status
 * downstream where dependencies are affected.
 */
export class DependencyService {
  constructor(private readonly deadlineRepo: DeadlineRepository) {}

  /* -------------------------------------------------------------------------- */
  /* Graph operations (detection is the only write; all reads are fetch-only)    */
  /* -------------------------------------------------------------------------- */

  /**
   * Build the full mandate graph from all deadlines in the tenant.
   *
   * Returns an adjacency list:
   *   - key: fromDeadlineId (the blocker)
   *   - value: array of toDeadlineId (the dependent)
   */
  async buildGraph(tenantId: number): Promise<Record<number, number[]>> {
    const deadlines = await this.deadlineRepo.findByTenantId(tenantId);

    // Build edges from dependency records first.
    const edges = new Map<number, Set<number>>();

    for (const deadline of deadlines) {
      // For each record, we want to answer:
      //   - What deadlines depend on THIS one (dependents)
      //   - What deadlines THIS one depends on (dependencies)
      // We'll load that from the dependency table rather than the stored array.
    }

    // Load edges from the dependency table.
    for (const deadline of deadlines) {
      const dependents = await this.deadlineRepo.findDependents(deadline.id);
      for (const toId of dependents) {
        edges.set(deadline.id, edges.get(deadline.id) ?? new Set());
        edges.get(deadline.id)!.add(toId);
      }
    }

    return Object.fromEntries(
      Array.from(edges.entries()).map(([fromId, toIds]) => [fromId, Array.from(toIds)])
    );
  }

  /**
   * Detect cycles in the mandate graph and return a message for the first found cycle.
   * Uses DFS with coloring.
   */
  detectCycle(graph: Record<number, number[]>): string | null {
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;

    const visited = new Map<number, number>();

    const dfs = (u: number): string | null => {
      visited.set(u, GRAY);

      const neighbors = graph[u] ?? [];

      for (const v of neighbors) {
        if (visited.get(v) === GRAY) {
          return `Circular dependency detected from ${u} → ${v}`;
        }

        if (visited.get(v) === WHITE) {
          const cycle = dfs(v);
          if (cycle) return cycle;
        }
      }

      visited.set(u, BLACK);
      return null;
    };

    for (const node of Object.keys(graph)) {
      if (visited.get(Number(node)) === WHITE) {
        const cycle = dfs(Number(node));
        if (cycle) return cycle;
      }
    }

    return null;
  }

  /**
   * Propagate health status downstream.
   *
   * When a deadline changes status to at_risk or off_track, this passes the
   * change to all its direct dependents.
   *
   * This returns a list of IDs that were updated.
   */
  async propagateHealth(
    deadlineId: number,
    newStatus: 'on_track' | 'at_risk' | 'off_track' | 'missed',
    reason?: string
  ): Promise<number[]> {
    // Build the full graph to locate dependents across tenant.
    const graph = await this.buildGraph(0); // No tenant filter here yet; propagate broadly for health to keep graphs simple.

    // Find direct dependents.
    const dependents = graph[deadlineId] ?? [];

    const updated: number[] = [];

    for (const toId of dependents) {
      // Apply heuristic: status propagation.
      const current = await this.deadlineRepo.findById(toId);
      if (!current) {
        continue;
      }

      // If the dependent is already off_track or missed, no further impact.
      if (current.healthOverride !== null) {
        // Wait: healthOverride is the manual override, not the auto status yet.
      }

      // Simple rule: blocked => at_risk (even if manually overridden; we
      // still want to surface the change).
      const updatedProps = {
        healthOverride: newStatus,
        healthOverrideReason: `Blocked by ${deadlineId} (${newStatus}${reason ? ': ' + reason : ''})`,
      };

      const fresh = await this.deadlineRepo.updateProps(toId, updatedProps);
      if (fresh) {
        updated.push(fresh.id);
        await this.deadlineRepo.updateProps(fresh.id, updatedProps);
        updated.push(fresh.id);
      }
    }

    return updated;
  }
}