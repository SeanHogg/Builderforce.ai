import type { Deadline, DeadlineCreate, DeadlineProps, DeadlineUpdate, HealthStatus } from './Deadline';

/**
 * Lightweight read model used for listing/filtering, typically returned by
 * `findAll`. Not every field of `Deadline` is needed in list views.
 */
export interface DeadlineRead {
  id: number;
  title: string;
  type: string;
  ownerId: string;
  projectId: number | null;
  dueDate: Date;
  forecastDate: Date | null;
  tags: string[];
  priority: string;
  healthStatus: HealthStatus;
  healthOverride: HealthStatus | null;
  healthOverrideReason: string | null;
  dependents: number[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Interface for persisting and querying `Deadline` aggregates.
 *
 * Implementations are provided by infrastructure layer (e.g. `DeadlineRepository`).
 */
export interface IDeadlineRepository {
  /** Create a new deadline, returning its DB id. */
  create(input: DeadlineCreate): Promise<number>;

  /** Read a single deadline by id. */
  findById(id: number): Promise<Deadline | undefined>;

  /** Update deadline fields, recording the actor for audit. */
  updateProps(
    id: number,
    patch: Partial<DeadlineUpdate & { dueDate?: string }>,
    actor: string,
  ): Promise<Deadline>;

  /** List deadlines matching optional filters. */
  findAll(filters: {
    type?: string;
    status?: string;
    ownerId?: string;
    projectId?: number;
    tag?: string;
    priority?: string;
    search?: string;
    page: number;
    limit: number;
    sort: string;
    order: 'asc' | 'desc';
  }): Promise<{ data: Deadline[]; total: number }>;

  /** Delete a deadline by id. */
  delete(id: number): Promise<void>;

  /** Get a deadline's dependencies graph edges. */
  getDependencies(id: number): Promise<Array<{ id: number; title: string }>>;

  /** Get all deadlines that depend on this id. */
  getDependents(id: number): Promise<Array<{ id: number; title: string }>>;

  /** Add an upstream dependency (blocker) to a deadline. */
  addDependency(id: number, dependencyId: number): Promise<void>;

  /** Remove an upstream dependency from a deadline. */
  removeDependency(id: number, dependencyId: number): Promise<void>;

  /** Count deadlines matching given filters. */
  count(filters: {
    type?: string;
    status?: string;
    ownerId?: string;
    projectId?: number;
    tag?: string;
    priority?: string;
  }): Promise<number>;
}
