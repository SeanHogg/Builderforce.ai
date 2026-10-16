/**
 * The project-lifecycle axis — idea / make / run / measure / reach. A run carries it
 * as an ephemeral nudge (a canvas phase is a per-browser choice no durable field
 * stores), orthogonal to the call-purpose {@link ModelRole}.
 */

export type ArcStage = 'idea' | 'make' | 'run' | 'measure' | 'reach';

export const ARC_STAGES: readonly ArcStage[] = ['idea', 'make', 'run', 'measure', 'reach'];

const ARC_STAGE_SET = new Set<string>(ARC_STAGES);

export function isArcStage(value: unknown): value is ArcStage {
  return typeof value === 'string' && ARC_STAGE_SET.has(value);
}
