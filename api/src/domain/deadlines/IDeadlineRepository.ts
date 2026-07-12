import { Deadline, DeadlineProps, DeadlineStatus } from './Deadline.js';
import { TenantId, ProjectId } from '../shared/types.js';

/** Public-facing Create DTO. */
export interface DeadlineCreate {
  tenantId: TenantId;
  projectId?: ProjectId;
  title: string;
  type: 'business' | 'customer';
  owner: string;
  dueDate: string;
  priority?: 'p1' | 'p2' | 'p3';
  tags?: string[];
  description?: string;
}

/** Full Update DTO include changes to health status. */
export interface DeadlineUpdate {
  title?: string;
  type?: 'business' | 'customer';
  owner?: string;
  dueDate?: string;
  priority?: 'p1' | 'p2' | 'p3';
  tags?: string[];
  description?: string;
  dependentDeadlineIds?: number[];
  healthOverride?: 'on_track' | 'at_risk' | 'off_track' | 'missed';
  healthOverrideReason?: string;
}

/** Full Read DTO: status computed from health engine, flags for overrides/slips. */
export interface DeadlineRead extends DeadlineCreate {
  id: number;
  createdAt: string;
  updatedAt: string;
  status: DeadlineStatus;
  healthOverride?: 'on_track' | 'at_risk' | 'off_track' | 'missed';
  healthOverrideReason?: string;
  dependents: number[];
}

/**
 * Repository contract for deadlines.
 */
export interface IDeadlineRepository {
  create(props: DeadlineProps): Deadline | Promise<Deadline>;
  findById(id: number): Promise<DeadlineRead | null>;
  findByProjectId(projectId: number): Promise<DeadlineRead[]>;
  findByTenantId(tenantId: number): Promise<DeadlineRead[]>;
  update(id: number, props: Partial<DeadlineProps>): Promise<DeadlineRead | null>;
  delete(id: number): Promise<boolean>;
  list(activeOnly?: boolean): Promise<DeadlineRead[]>;
}

/**
 * Repository for deadlines with dependency support.
 */
export interface IDependencyRepository {
  findDependencies(deadlineId: number): Promise<number[]>;
  findDependents(deadlineId: number): Promise<number[]>;
  link(fromDeadlineId: number, toDeadlineId: number): Promise<void>;
  unlink(deadlineId: number, dependentId: number): Promise<void>;
}