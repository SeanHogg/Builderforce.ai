/**
 * Governance & security entities — owned by **Security** (PRD 20 §3.2,
 * migration 0428).
 *
 * Legal acceptances and WebAuthn challenges are evidence. Stakeholder alignment
 * rows are coordinated by one workflow service so its review, response, conflict,
 * and escalation invariants cannot be bypassed by generic writes.
 */
import {
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
]);
