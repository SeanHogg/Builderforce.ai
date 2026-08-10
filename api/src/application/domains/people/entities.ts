/**
 * People & HR entities — owned by **HR** (PRD 20 §3.2, migration 0420).
 *
 * The learning half of this domain is the one PRD 19 §2 gave to BurnRateOS's
 * LMS: courses, modules, lessons, enrolments, cohorts and certificates, plus the
 * two standards connectors (SCORM's CMI state and xAPI's LRS documents) that
 * make an external LMS able to read it.
 */
import {
  badges,
  competencies,
  courseCertificates,
  courseCheckouts,
  courseEnrollments,
  courseLessons,
  courseModules,
  courses,
  headcountImpacts,
  healthDimensions,
  hrEmergencyContacts,
  hrEmploymentRecords,
  learningCohorts,
  lmsConnectors,
  lmsCoursePublishes,
  lrsDocuments,
  peopleEmployees,
  peopleHeadcountPlans,
  peopleObjectiveOutcomes,
  peopleTenants,
  peopleWorkflowTriggers,
  scormCmiStates,
} from '../../../infrastructure/database/schema/people';
import { defineDomainEntities, entity } from '../entityDefinition';

export const PEOPLE_ENTITIES = defineDomainEntities('people', [
  entity(peopleEmployees, { kind: 'employee', registers: true }),
  entity(courses, { kind: 'course', registers: true }),
  entity(learningCohorts, { kind: 'cohort', registers: true }),
  hrEmploymentRecords,
  hrEmergencyContacts,
  peopleTenants,
  peopleHeadcountPlans,
  headcountImpacts,
  peopleObjectiveOutcomes,
  peopleWorkflowTriggers,
  healthDimensions,
  competencies,
  badges,
  courseModules,
  courseLessons,
  courseEnrollments,
  courseCertificates,
  /** A checkout is the money half of an order (§5 step 3's adjudication). It is
   *  settled by the payment path, not edited. */
  entity(courseCheckouts, { readOnly: true }),
  lmsConnectors,
  lmsCoursePublishes,
  /** SCORM and xAPI state is written by the runtime the standard defines; a hand
   *  edit is a falsified completion record. */
  entity(scormCmiStates, { readOnly: true }),
  entity(lrsDocuments, { readOnly: true }),
]);
