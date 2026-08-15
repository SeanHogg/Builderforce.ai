/**
 * Delivery & work entities — owned by the **Manager** (PRD 20 §3.2, migration 0431).
 *
 * The domain's root is the kernel's `work_item`: task, epic, story, subtask,
 * objective, key result, initiative and milestone are one shape with a kind
 * (§2), which is why there is no task table, no epic table and no objective
 * table here. What survives is the machinery around the work — the board's
 * columns, the approvals, the estimates and the analyses.
 */
import {
  actionItems,
  approvalActions,
  bottleneckAnalysis,
  capacityHeatmaps,
  kanbanColumns,
  listItems,
  portfolioCompanies,
  portfolioItems,
  realizations,
  releaseNoteBetaEnrollments,
  releasePlans,
  signOffs,
  sprintFinancialImpact,
  syncAgendaItems,
  syncConflictResolutions,
  taskEffortEstimates,
  taskTimeEntries,
} from '../../../infrastructure/database/schema/delivery';
import { defineDomainEntities, entity } from '../entityDefinition';

export const DELIVERY_ENTITIES = defineDomainEntities('delivery', [
  entity(releasePlans, { kind: 'release', registers: true }),
  kanbanColumns,
  actionItems,
  approvalActions,
  signOffs,
  taskEffortEstimates,
  taskTimeEntries,
  syncAgendaItems,
  syncConflictResolutions,
  portfolioCompanies,
  portfolioItems,
  listItems,
  /** Derived analyses: recomputed from the work, never typed over. */
  entity(bottleneckAnalysis, { readOnly: true }),
  entity(capacityHeatmaps, { readOnly: true }),
  entity(sprintFinancialImpact, { readOnly: true }),
  /** Enrollment records capture a user's beta consent and are changed only by
   *  the release-note enrollment workflow. */
  entity(releaseNoteBetaEnrollments, { readOnly: true }),
  /** One act of making an idea real: what was planned, what the build produced,
   *  where it went live. A record OF work, so the builder is its single writer —
   *  a hand-edited `status` or `result` would answer "what did it actually do?"
   *  with something nothing ran. */
  entity(realizations, { readOnly: true }),
]);
