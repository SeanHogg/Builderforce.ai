import { z } from 'zod';
import { SLIP_REASON_SCHEMA, type SlipReason } from '../../application/deadlines/utils/SlipTaxonomy';

// ---- Health status ----
export const HEALTH_STATUSES = ['on_track', 'at_risk', 'off_track', 'missed'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

// ---- Priority tiers ----
export const PRIORITY_TIERS = ['P1', 'P2', 'P3'] as const;
export type PriorityTier = (typeof PRIORITY_TIERS)[number];

// ---- Deadline Type ----
export const DEADLINE_TYPE_VALUES = ['Business', 'Customer'] as const;
export type DeadlineType = (typeof DEADLINE_TYPE_VALUES)[number];

// ---- Core Deadline shapes ----

/**
 * Immutable state of a deadline in the domain.
 */
export interface DeadlineProps {
  id: number;
  title: string;
  type: DeadlineType;
  ownerId: string;
  projectId?: number | null;
  description?: string | null;
  dueDate: Date;
  forecastDate?: Date | null;
  tags: string[];
  priority: PriorityTier;
  healthStatus: HealthStatus;
  healthOverride?: HealthStatus | null;
  healthOverrideReason?: string | null;
  dependents: number[];
  // computed dynamic fields, filled by repository/read-model
  dependencies?: number[];
  completed?: boolean | null;
  completedAt?: Date | null;
  slipCount?: number;
  lastSlipReason?: SlipReason | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---- Value object ----

/**
 * Domain value-object wrapping deadline state with business logic.
 *
 * Immutable — mutation methods return a new instance.
 */
export class Deadline implements DeadlineProps {
  readonly id!: number;
  readonly title!: string;
  readonly type!: DeadlineType;
  readonly ownerId!: string;
  readonly projectId!: number | null;
  readonly description!: string | null;
  readonly dueDate!: Date;
  readonly forecastDate!: Date | null;
  readonly tags!: string[];
  readonly priority!: PriorityTier;
  readonly healthStatus!: HealthStatus;
  readonly healthOverride!: HealthStatus | null;
  readonly healthOverrideReason!: string | null;
  readonly dependents!: number[];
  readonly dependencies!: number[];
  readonly completed!: boolean | null;
  readonly completedAt!: Date | null;
  readonly slipCount!: number;
  readonly lastSlipReason!: SlipReason | null;
  readonly createdAt!: Date;
  readonly updatedAt!: Date;

  // ---- Static factory ----

  public static from(props: DeadlineProps): Deadline {
    const instance = new Deadline();
    return Object.assign(instance, {
      ...props,
      dependencies: props.dependencies ?? [],
      completed: props.completed ?? null,
      completedAt: props.completedAt ?? null,
      slipCount: props.slipCount ?? 0,
      lastSlipReason: props.lastSlipReason ?? null,
      projectId: props.projectId ?? null,
      description: props.description ?? null,
      forecastDate: props.forecastDate ?? null,
      healthOverride: props.healthOverride ?? null,
      healthOverrideReason: props.healthOverrideReason ?? null,
    });
  }

  // ---- Business logic helpers ----

  public get isOverdue(): boolean {
    return this.dueDate < new Date() && this.healthStatus !== 'missed';
  }

  public get effectiveStatus(): HealthStatus {
    return this.healthOverride ?? this.healthStatus;
  }

  /**
   * True when this deadline has an active manual override with a reason.
   */
  public get overrideActive(): boolean {
    return this.healthOverride !== null && this.healthOverrideReason !== null;
  }
}

/**
 * Simple runtime schema validation for incoming data.
 * Not exhaustive by design — just enough to reject malformed input at the API edge.
 */
export const deadlineCreateSchema = z.object({
  title: z.string().min(1),
  type: z.enum(DEADLINE_TYPE_VALUES),
  ownerId: z.string().min(1),
  dueDate: z.string().datetime().or(z.string().date()),
  projectId: z.number().positive().nullable().optional(),
  description: z.string().nullable().optional(),
  dependencies: z.array(z.number().positive()).optional(),
  priority: z.enum(PRIORITY_TIERS).optional().default('P2'),
  tags: z.array(z.string()).optional().default([]),
  forecastDate: z.string().datetime().or(z.string().date()).nullable().optional(),
});

export type DeadlineCreate = z.infer<typeof deadlineCreateSchema>;

export const deadlineUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  type: z.enum(DEADLINE_TYPE_VALUES).optional(),
  ownerId: z.string().min(1).optional(),
  dueDate: z.string().datetime().or(z.string().date()).optional(),
  projectId: z.number().positive().nullable().optional(),
  description: z.string().nullable().optional(),
  dependencies: z.array(z.number().positive()).optional(),
  priority: z.enum(PRIORITY_TIERS).optional(),
  tags: z.array(z.string()).optional(),
  forecastDate: z.string().datetime().or(z.string().date()).nullable().optional(),
  completed: z.boolean().optional(),
  healthOverride: z.enum(HEALTH_STATUSES).nullable().optional(),
  healthOverrideReason: z.string().nullable().optional(),
  slipReason: SLIP_REASON_SCHEMA.optional(),
});

export type DeadlineUpdate = z.infer<typeof deadlineUpdateSchema>;

export const deadlineQuerySchema = z.object({
  type: z.enum(DEADLINE_TYPE_VALUES).optional(),
  status: z.enum(HEALTH_STATUSES).optional(),
  ownerId: z.string().optional(),
  projectId: z.coerce.number().positive().optional(),
  tag: z.string().optional(),
  priority: z.enum(PRIORITY_TIERS).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(200).optional().default(50),
  sort: z.enum(['dueDate', 'priority', 'createdAt', 'title']).optional().default('dueDate'),
  order: z.enum(['asc', 'desc']).optional().default('asc'),
});

export type DeadlineQuery = z.infer<typeof deadlineQuerySchema>;
