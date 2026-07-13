export interface IDependencyRepository {
  link(dependencyId: number, dependeeId: number): Promise<void>;
  unlink(dependencyId: number, dependeeId: number): Promise<void>;
  findUpstream(deadlineId: number): Promise<number[]>;
  findDependents(deadlineId: number): Promise<number[]>;
}