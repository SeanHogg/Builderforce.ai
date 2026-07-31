import { z } from 'zod';

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

export const SLIP_REASON_SCHEMA = z.enum([
  'Scope Change',
  'Dependency Block',
  'Resource Constraint',
  'External / Customer',
  'Technical Blocker',
  'Other',
]);

export type InferredSlipReason = z.infer<typeof SLIP_REASON_SCHEMA>;

/** Type guard / validator helper: uses taxonomy set for membership check. */
export const isValidSlipReason = (v: string): v is SlipReason =>
  (SLIP_REASON_TAXONOMY as readonly string[]).includes(v);

export default SLIP_REASON_TAXONOMY;
