import { ProjectId, TenantId } from '../shared/types.js';
import { ValidationError } from '../shared/errors.js';

export type DeadlineType = 'business' | 'customer';
export type DeadlineStatus = 'on_track' | 'at_risk' | 'off_track' | 'missed';
export type DeadlinePriority = 'p1' | 'p2' | 'p3';

/** Valid slip reason taxonomy. */
export const SLIP_REASON_TAXONOMY = [
  'Scope Change',
  'Dependency Block',
  'Resource Constraint',
  'External / Customer',
  'Technical Blocker',
  'Other',
] as const;

/** Stored properties in the database. */
export interface DeadlineProps {
  id?: number;
  tenantId: number;
  projectId?: ProjectId;
  title: string;
  type: DeadlineType;
  owner: string;
  dueDate: Date;
  priority: DeadlinePriority;
  tags: string[];
  description?: string | null;
  dependents?: number[];
  healthOverride?: 'on_track' | 'at_risk' | 'off_track' | 'missed';
  healthOverrideReason?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export class Deadline {
  private constructor(private props: DeadlineProps) {}

  // --- Factories ---------------------------------------------------------

  static create(
    props: Omit<DeadlineProps, 'id' | 'createdAt' | 'updatedAt'>,
  ): Deadline {
    if (!props.title.trim())
      throw new ValidationError('Title is required');
    if (!props.owner.trim())
      throw new ValidationError('Owner is required');
    if (
      props.type !== 'business' &&
      props.type !== 'customer'
    )
      throw new ValidationError('Type must be business or customer');
    if (props.tags.some((t) => !t.trim()))
      throw new ValidationError('Tags must be non-empty strings');

    return new Deadline({
      ...props,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  /** Reconstitute from the DB. */
  static reconstitute(props: DeadlineProps): Deadline {
    return new Deadline(props);
  }

  // --- Accessors ---------------------------------------------------------

  get id(): number | undefined {
    return this.props.id;
  }

  get tenantId(): number {
    return this.props.tenantId;
  }

  get projectId(): ProjectId | undefined {
    return this.props.projectId;
  }

  get title(): string {
    return this.props.title;
  }

  get type(): DeadlineType {
    return this.props.type;
  }

  get owner(): string {
    return this.props.owner;
  }

  get dueDate(): Date {
    return this.props.dueDate;
  }

  get priority(): DeadlinePriority {
    return this.props.priority;
  }

  get tags(): string[] {
    return this.props.tags;
  }

  get description(): string | null {
    return this.props.description ?? null;
  }

  /** In the DB we store an array; in memory, we often want a flat set */
  get dependentsSet(): Set<number> {
    return new Set(this.props.dependents ?? []);
  }

  get healthOverride(): 'on_track' | 'at_risk' | 'off_track' | 'missed' | undefined {
    return this.props.healthOverride;
  }

  get healthOverrideReason(): string | null {
    return this.props.healthOverrideReason ?? null;
  }

  get createdAt(): Date {
    return this.props.createdAt!;
  }

  get updatedAt(): Date {
    return this.props.updatedAt!;
  }

  // --- Mutations ---------------------------------------------------------

  update(updates: Partial<DeadlineProps>): Deadline {
    const merged = { ...this.props, ...updates };
    return new Deadline({ ...merged, updatedAt: new Date() });
  }

  /** Attach a downstream deadline (depends on me). */
  addDependent(deadlineId: number): Deadline {
    const dependentsSet = this.dependentsSet;
    if (!dependentsSet.has(deadlineId)) {
      dependentsSet.add(deadlineId);
      return new Deadline({ ...this.props, dependents: Array.from(dependentsSet) });
    }
    return this;
  }

  /** Set a health override (admin-only). */
  withHealthOverride(
    status: 'on_track' | 'at_risk' | 'off_track' | 'missed',
    reason: string | null,
  ): Deadline {
    return new Deadline({ ...this.props, healthOverride: status, healthOverrideReason: reason });
  }

  /** Snapshot for persistence. */
  toPlain(): DeadlineProps {
    return { ...this.props };
  }
}