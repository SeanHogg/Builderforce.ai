import { eq } from 'drizzle-orm';
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
