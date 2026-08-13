/**
 * Hiring entities — owned by the **Recruiter** (PRD 20 §3.2, migration 0419).
 *
 * `job_applications`, `interviews` and `placements` are the three a person
 * navigates to, so they register in `objects` and appear in the seat's items
 * list; the rest are their satellites and are reached through them.
 */
import {
  candidateDemographics,
  candidateInteractions,
  candidateResumes,
  cohortRetention,
  hiringDecisions,
  interviewKitStages,
  interviewKits,
  interviewQuestionSets,
  interviews,
  jobApplications,
  jobItems,
  jobPipelineEntries,
  jobWebsites,
  offerLetters,
  outplacementPackages,
  placementDocuments,
  placementSplits,
  placements,
  rampTimes,
  recruiterAgentFollowups,
  recruiterOutreachSequences,
  retainedSearchFirms,
  scorecardAttributes,
  screeningTemplateItems,
} from '../../../infrastructure/database/schema/hiring';
import { defineDomainEntities, entity } from '../entityDefinition';

export const HIRING_ENTITIES = defineDomainEntities('hiring', [
  entity(jobApplications, { kind: 'application', registers: true }),
  entity(interviews, { kind: 'interview', registers: true }),
  entity(placements, { kind: 'placement', registers: true }),
  candidateResumes,
  candidateInteractions,
  /**
   * NOT reachable through the generic entity reader.
   *
   * `candidate_demographics` holds self-identified EEO data, which is collected for
   * statutory reporting and is unlawful to use in an assessment. The generic reader is
   * how any seat browses any registered entity, so registering it readable would put a
   * protected characteristic one click from the shortlist that must not consider it.
   * Aggregate reporting reads it through a named service that returns counts without
   * identifiers; nothing reads it row-by-row beside a candidate. See migration 0460.
   */
  entity(candidateDemographics, { restricted: true }),
  jobPipelineEntries,
  interviewKits,
  interviewKitStages,
  interviewQuestionSets,
  scorecardAttributes,
  screeningTemplateItems,
  hiringDecisions,
  offerLetters,
  /** A split is a commission share. Money is corrected by the service that owns
   *  the payout, never by a generic PATCH — see the kernel's ledger note. */
  entity(placementSplits, { readOnly: true }),
  placementDocuments,
  outplacementPackages,
  retainedSearchFirms,
  recruiterOutreachSequences,
  recruiterAgentFollowups,
  jobItems,
  jobWebsites,
  rampTimes,
  cohortRetention,
]);
