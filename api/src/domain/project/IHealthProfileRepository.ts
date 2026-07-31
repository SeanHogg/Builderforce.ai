import type { ProjectId } from '../shared/types';
import type {
  HealthProfileProps,
  HealthProfileAnswers,
  HealthProfileComputedScores,
  HealthProfileVersionProps,
} from './HealthProfile';

/**
 * Port (in Hexagonal Architecture terms): the contract the application layer
 * depends on. Infrastructure provides the concrete adapter.
 */
export interface IHealthProfileRepository {
  /**
   * Find the active health profile for a project
   */
  findByProjectId(projectId: ProjectId): Promise<HealthProfileProps | null>;

  /**
   * Create a new health profile for a project
   */
  create(profile: {
    projectId: ProjectId;
    answers: HealthProfileAnswers;
    computedScores?: HealthProfileComputedScores;
    submittedBy: string | null;
  }): Promise<HealthProfileProps>;

  /**
   * Update an existing health profile
   */
  update(projectId: ProjectId, updates: {
    answers: HealthProfileAnswers;
    computedScores?: HealthProfileComputedScores;
    submittedBy: string | null;
  }): Promise<HealthProfileProps>;

  /**
   * Create a version snapshot of the current profile before updating
   */
  createVersionSnapshot(profile: HealthProfileProps, createdBy: string | null): Promise<HealthProfileVersionProps>;

  /**
   * Get all versions for a project's health profile
   */
  getVersions(projectId: ProjectId, options?: {
    limit?: number;
    offset?: number;
  }): Promise<HealthProfileVersionProps[]>;

  /**
   * Get a specific version by ID
   */
  getVersionById(versionId: string): Promise<HealthProfileVersionProps | null>;

  /**
   * Get the count of versions for a project
   */
  getVersionCount(projectId: ProjectId): Promise<number>;

  /**
   * Delete health profile (cascade from project delete)
   */
  deleteByProjectId(projectId: ProjectId): Promise<void>;
}
