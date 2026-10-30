import { and, eq, ne } from 'drizzle-orm';
import { runModelOutcomes } from '../../infrastructure/database/schema';

/**
 * `run_model_outcomes.routing_signal` means: THIS ROW IS CODING-RUN EVIDENCE.
 *
 * A telemetry-only report (a Creation Canvas turn) is recorded for the uniform §8.2 row but
 * is not evidence about how well agents CODE: it is never merged, never CI-checked, and its
 * score is completion and efficiency alone. Every lens that ranks models for coding work,
 * seeds recall, compares variants or measures coding effectiveness (merge rate, score, steps
 * per run) reads through this predicate, so such a row cannot skew it.
 */
export const codingEvidence = eq(runModelOutcomes.routingSignal, true);

/**
 * Whether a stored outcome TEACHES the routing table, at read time: coding-run evidence that is not a
 * run the person stopped and not one the tenant's quota ended. The reconcile (both grains), the recall
 * seed and variant eval read through it, so a rebuild admits exactly what the live fold
 * (`foldsIntoRouting` in `@builderforce/learned-routing`) admitted. The spend and effectiveness lenses
 * read `codingEvidence` alone, so a stopped run still counts there and a stop rate stays computable.
 */
export const teachesRouting = and(
  codingEvidence,
  ne(runModelOutcomes.terminalStatus, 'cancelled'),
  eq(runModelOutcomes.quotaExhausted, false),
);
