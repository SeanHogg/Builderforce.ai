import {
  z,
  type ZodType,
  type ZodError,
  zodToOpenAPI,
} from 'zod';
import { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------
// Types helpers (borrow from service)
// ---------------------------------------------------------------------
export enum DeadlineType {
  Business = 'business',
  Customer = 'customer',
}

export enum DeadlinePriority {
  P1 = 'p1',
  P2 = 'p2',
  P3 = 'p3',
}

export type DeadlineHealthStatus =
  | 'on_track'
  | 'at_risk'
  | 'off_track'
  | 'missed';

export type HealthOverrideStatus =
  | DeadlineHealthStatus
  | null;

// ---------------------------------------------------------------------
// Validation & DTOs (Zod)
// ---------------------------------------------------------------------

/**
 * DeadlineCreateDTO: fields accepted on POST /deadlines
 */
export interface DeadlineCreateDTO {
  tenantId?: number;
  projectId?: number;
  title: string;
  type: DeadlineType;
  owner: string;
  dueDate: string | Date;
  priority: DeadlinePriority;
  tags: string[];
  description?: string;
  dependents?: number[];
  syncedFromSource?: string;
  externalSystem?: string;
}

export const deadlineCreateSchema: ZodType<DeadlineCreateDTO> = z
  .object({
    tenantId: z.number().int().positive().optional(),
    projectId: z.number().int().positive().optional(),
    title: z
      .string()
      .min(1, 'title is required')
      .max(500, 'title must not exceed 500 characters')
      .trim(),
    type: z.enum([DeadlineType.Business, DeadlineType.Customer]),
    owner: z
      .string()
      .min(1, 'owner is required')
      .max(255, 'owner must not exceed 255 characters')
      .trim(),
    dueDate: z.coerce.date('dueDate must be a valid date'),
    priority: z.enum([DeadlinePriority.P1, DeadlinePriority.P2, DeadlinePriority.P3]),
    tags: z.array(z.string().min(1).max(50)).min(1, 'at least one tag is required'),
    description: z.string().max(5000).optional(),
    dependents: z.array(z.number().int().positive()).optional(),
    syncedFromSource: z.string().max(255).optional(),
    externalSystem: z.string().max(100).optional(),
  })
  .strict({ message: 'unknown fields provided' });

/**
 * DeadlineUpdateDTO: fields accepted on PATCH /deadlines/{id}
 */
export interface DeadlineUpdateDTO {
  title?: string;
  type?: DeadlineType;
  owner?: string;
  dueDate?: string | Date;
  priority?: DeadlinePriority;
  tags?: string[];
  description?: string;
  dependents?: number[];
  slipReason?: string;
}

export const canRequireSlipReason = (
  updates: DeadlineUpdateDTO,
): boolean => {
  const { dueDate, dependents } = updates;
  return !!(dueDate !== undefined || (dependents !== undefined && dependents.length > 0));
};

export const deadlineUpdateSchema: ZodType<DeadlineUpdateDTO> = z
  .object({
    title: z
      .string()
      .min(1, 'title is required')
      .max(500, 'title must not exceed 500 characters')
      .trim()
      .optional(),
    type: z.enum([DeadlineType.Business, DeadlineType.Customer]).optional(),
    owner: z
      .string()
      .min(1, 'owner is required')
      .max(255, 'owner must not exceed 255 characters')
      .trim()
      .optional(),
    dueDate: z.coerce.date('dueDate must be a valid date').optional(),
    priority: z.enum([DeadlinePriority.P1, DeadlinePriority.P2, DeadlinePriority.P3]).optional(),
    tags: z.array(z.string().min(1).max(50)).optional(),
    description: z.string().max(5000).optional(),
    dependents: z.array(z.number().int().positive()).optional(),
    slipReason: z.string().optional(),
  })
  .strict({ message: 'unknown fields provided' });

/**
 * DeadlineHealthOverrideDTO: fields accepted on PATCH /deadlines/{id}/health
 */
export interface DeadlineHealthOverrideDTO {
  status: HealthOverrideStatus;
  reason: string;
}

export const deadlineHealthOverrideSchema: ZodType<DeadlineHealthOverrideDTO> = z.object({
  status: z.enum(['on_track', 'at_risk', 'off_track', 'missed', null]),
  reason: z
    .string()
    .min(1, 'reason is required')
    .max(2000, 'reason must not exceed 2000 characters')
    .trim(),
}).strict({ message: 'unknown fields provided' });

/**
 * DeadlineHealthDTO: response type for GET /deadlines/{id}
 */
export interface DeadlineHealthDTO {
  status: DeadlineHealthStatus;
  override?: DeadlineHealthOverrideDTO;
  lastEvaluatedAt: string;
}

/**
 * DeadlineDTO: complete response type for GET /deadlines/{id}
 */
export interface DeadlineDTO {
  id: number;
  tenantId: number;
  projectId?: number;
  title: string;
  type: DeadlineType;
  owner: string;
  dueDate: string;
  priority: DeadlinePriority;
  tags: string[];
  description?: string;
  dependents: number[];
  dependentsResolved?: string[];
  health: DeadlineHealthStatus;
  override?: DeadlineHealthOverrideDTO;
  createdAt: string;
  updatedAt: string;
  syncedFromSource?: string;
  externalSystem?: string;
}

/**
 * Create an ExpressValidationError and respond with 422
 */
export function handleZodError(
  req: Request,
  res: Response,
  next: NextFunction,
  error: ZodError,
): void {
  const code = 'BAD_REQUEST';
  const messages = error.issues.map((i) => ({
    code: i.code,
    message: i.message,
    path: i.path.join('.'),
  }));

  // Merge with any API-specific details (e.g. MISSING_SLIP_REASON)
  const bodyErrors = messages.map((m): { code: string; message: string; path?: string } => ({
    code: m.code,
    message: m.message,
    path: m.path,
  }));

  res
    .status(422)
    .json({ errors: bodyErrors });
  next(); // if middleware chains
}

/**
 * Simplify a ZodError into a 422 response body
 */
export function zodErrorResponse(error: ZodError): {
  code: string;
  message: string;
  details: string;
} {
  const code = 'VALIDATION_ERROR';
  const message = 'Request validation failed';
  const details = error.issues
    .map((i) => `${i.path.join('.')} ${i.message}`)
    .join('; ');

  return { code, message, details };
}

/**
 * OpenAPI schema exporters
 */
export const createOpenAPI = () => zodToOpenAPI(deadlineCreateSchema);
export const updateOpenAPI = () => zodToOpenAPI(deadlineUpdateSchema);
export const healthOverrideOpenAPI = () => zodToOpenAPI(deadlineHealthOverrideSchema);

export default {
  DeadlineType,
  DeadlinePriority,
  DeadlineHealthStatus,
};