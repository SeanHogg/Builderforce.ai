/**
 * Governance & security entities — owned by **Security** (PRD 20 §3.2,
 * migration 0428).
 *
 * Legal acceptances and WebAuthn challenges are evidence. Stakeholder alignment
 * rows are coordinated by one workflow service so its review, response, conflict,
 * and escalation invariants cannot be bypassed by generic writes.
 */
import {
  governanceAuditGaps,
  governanceAuditRuns,
  governanceFindings,
  governancePolicyPacks,
  governanceRules,
  legalDocumentAcceptances,
  stakeholderAlignmentResponses,
  stakeholderAlignmentReviews,
  stakeholderConflicts,
  stakeholderEscalations,
  stakeholderHealthProfiles,
  stakeholderMapEntries,
  stakeholderPrioritySubmissions,
  webauthnChallenges,
} from '../../../infrastructure/database/schema/governance';
import { defineDomainEntities, entity } from '../entityDefinition';

export const GOVERNANCE_ENTITIES = defineDomainEntities('governance', [
  entity(legalDocumentAcceptances, { readOnly: true }),
  entity(webauthnChallenges, { readOnly: true }),
  entity(stakeholderMapEntries, { readOnly: true }),
  entity(stakeholderHealthProfiles, { readOnly: true }),
  entity(stakeholderPrioritySubmissions, { readOnly: true }),
  entity(stakeholderConflicts, { readOnly: true }),
  entity(stakeholderAlignmentReviews, { readOnly: true }),
  entity(stakeholderAlignmentResponses, { readOnly: true }),
  entity(stakeholderEscalations, { readOnly: true }),
  /** Open questions the governance-auditor sweep raises (1322): opened and resolved by
   *  that sweep, so a hand-resolved gap would be an answer nobody checked. */
  entity(governanceAuditGaps, { readOnly: true }),
  /** The governance-auditor's rule packs, rules, runs and findings (1336). Read-only:
   *  packs and rules are authored through the governance service that validates each
   *  `check` matcher, and a run and its findings are a record of an audit — a hand-edited
   *  `gate_result` or finding `status` would claim a review nothing performed. */
  entity(governancePolicyPacks, { readOnly: true }),
  entity(governanceRules, { readOnly: true }),
  entity(governanceAuditRuns, { readOnly: true }),
  entity(governanceFindings, { readOnly: true }),
]);
