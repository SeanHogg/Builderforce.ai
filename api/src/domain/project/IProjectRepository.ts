import { Project } from './Project';
import { ProjectId, TenantId } from '../shared/types';

/**
 * Port (in Hexagonal Architecture terms): the contract the application layer
 * depends on.  Infrastructure provides the concrete adapter.
 */
export interface IProjectRepository {
  findByTenant(tenantId: TenantId): Promise<Project[]>;
  findById(id: ProjectId): Promise<Project | null>;
  findByKey(key: string): Promise<Project | null>;
  save(project: Project): Promise<Project>;
  update(project: Project): Promise<Project>;
  delete(id: ProjectId): Promise<void>;
}
