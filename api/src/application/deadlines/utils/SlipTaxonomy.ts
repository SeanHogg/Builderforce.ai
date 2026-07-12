/**
 * Slip reason taxonomy for deadline date resets and retrospective analysis.
 */
export const SLIP_REASON_TAXONOMY = [
  'Scope Change',
  'Dependency Block',
  'Resource Constraint',
  'External / Customer',
  'Technical Blocker',
  'Other',
] as const;

export type SlipReason = (typeof SLIP_REASON_TAXONOMY)[number];

/**
 * Re-export SLIP_REASON_TAXONOMY and SlipReason for the repository DTOs.
 * This avoids hardcoded constants in multiple files and ensures a shared reference.
 * inline import: 'zod' (assumed present in the module graph)
 */
import type { z } from 'zod';

export const SLIP_REASON_SCHEMA = z.enum([
  'Scope Change',
  'Dependency Block',
  'Resource Constraint',
  'External / Customer',
  'Technical Blocker',
  'Other',
]) satisfies z.ZodEnum<typeof SLIP_REASON_TAXONOMY>;

export type InferredSlipReason = z.infer<typeof SLIP_REASON_SCHEMA>;

/** Type guard / validator helper (inline): uses zod as static validator */
export const isValidSlipReason = (v: string): v is SlipReason => SLIP_REASON_TAXONOMY.includes(v as SlipReason);
 export default SLIP_REASON_TAXONOMY;