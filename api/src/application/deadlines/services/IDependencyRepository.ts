/**
 * Simplified read model for the dependency graph.
 *
 * This is consumed by `DependencyService` and implemented in
 * the infra layer via `DeadlineRepository` (which has `getDependencies`
 * and `getDependents` methods on `IDeadlineRepository`).
 */
export interface IDependencyRepository {
  /**
   * Fetch all upstream dependencies (blockers) for a given deadline.
   */
  findDependencies(id: number): Promise<Array<{ id: number; title: string }>>;

  /**
   * Fetch all downstream dependents (blocked by this deadline).
   */
  findDependents(id: number): Promise<Array<{ id: number; title: string }>>;

  /**
   * Create an edge: `dependencyId` blocks `id`.
   */
  addDependency(id: number, dependencyId: number): Promise<void>;

  /**
   * Remove an edge: stop `dependencyId` from blocking `id`.
   */
  removeDependency(id: number, dependencyId: number): Promise<void>;

  /**
   * Detect whether adding `dependencyId` → `id` would create a cycle.
   * Returns `true` if it WOULD create a cycle.
   */
  wouldCreateCycle(id: number, dependencyId: number): Promise<boolean>;
}
