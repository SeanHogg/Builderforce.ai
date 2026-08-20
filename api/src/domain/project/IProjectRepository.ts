import { Project } from './Project';
import { ProjectId, TenantId } from '../shared/types';

/**
 * Port (in Hexagonal Architecture terms): the contract the application layer
 * depends on.  Infrastructure provides the concrete adapter.
 */
export interface IProjectRepository {
  findByTenant(tenantId: TenantId): Promise<Project[]>;
  findById(id: ProjectId): Promise<Project | null>;
  findByPublicId(publicId: string): Promise<Project | null>;
  findByKey(key: string): Promise<Project | null>;
  /**
   * The DATA-ISOLATION segment that owns a project (`projects.segment_id`). Not a
   * Project domain field — it is an isolation column — but a task moving between
   * projects must adopt the destination's segment, so the mover needs to read it.
   * Null on a single-segment tenant.
   */
  segmentIdOf(id: ProjectId): Promise<string | null>;
  save(project: Project): Promise<Project>;
  update(project: Project): Promise<Project>;
  delete(id: ProjectId): Promise<void>;
}
