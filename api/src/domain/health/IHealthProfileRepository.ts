import { HealthProfile } from './HealthProfile';
import { ProjectId, TenantId } from '../shared/types';

/**
* Port for health profile persistence.
* Application layer depends on this; infrastructure provides Drizzle/Postgres implementation.
*/
export interface IHealthProfileRepository {
  /** Find active HealthProfile for a project (by ID). */
  findByProjectId(projectId: ProjectId): Promise<HealthProfile | null>;

  /** Find a historical version by its stored versionId. */
  findVersionById(versionId: string): Promise<HealthProfile | null>;

  /** Save a new HealthProfile (create or replace). Also creates a version snapshot. */
  saveWithVersion(profile: HealthProfile): Promise<{ profile: HealthProfile; versionId: string }>;

  /** Delete the active profile for a project (or all versions). */
  deleteByProjectId(projectId: ProjectId): Promise<void>;

  /** List all version IDs for a project (without the full profile payload). */
  listVersions(projectId: ProjectId): Promise<string[]>;

  /** Find all versions for a project (by projectId, descending creation order). */
  findVersionsByProject(projectId: ProjectId): Promise<HealthProfile[]>;
}