/**
 * Identity & tenancy entities — owned by **the platform** (PRD 20 §3.2,
 * migration 0430).
 *
 * `email_otp_challenges` is the one legacy consolidation §5 step 3 finished end
 * to end: two one-time-code stores became one with a `purpose` column, scoped so
 * a newsletter opt-in can never satisfy an account activation. Like every other
 * credential-adjacent row here it is read-only — a one-time code somebody can
 * PATCH is not a one-time code.
 */
import {
  availabilitySlots,
  countries,
  emailOtpChallenges,
  extensionSessions,
  onboardingChecklists,
  onboardingFlows,
  onboardingProgress,
  onboardingTasks,
  regionWaitlist,
  sessionDiscussions,
  sessions,
  stageLookup,
  userBadges,
  userStockMediaUsage,
  userTermsAgreements,
  workspaceGrants,
} from '../../../infrastructure/database/schema/identity';
import { defineDomainEntities, entity } from '../entityDefinition';

export const IDENTITY_ENTITIES = defineDomainEntities('identity', [
  onboardingFlows,
  onboardingChecklists,
  onboardingTasks,
  onboardingProgress,
  workspaceGrants,
  availabilitySlots,
  sessionDiscussions,
  regionWaitlist,
  userBadges,
  userStockMediaUsage,
  /** Sessions ARE the authentication. Listing them powers `/security`'s device
   *  list; editing one is session fixation with a REST endpoint. */
  entity(sessions, { readOnly: true }),
  entity(extensionSessions, { readOnly: true }),
  entity(emailOtpChallenges, { readOnly: true }),
  /** What somebody agreed to, and when. Evidence, like the governance pair. */
  entity(userTermsAgreements, { readOnly: true }),
  /** Global reference data, not tenant rows: readable by every tenant,
   *  writable by none. */
  entity(countries, { readOnly: true, global: true }),
  entity(stageLookup, { readOnly: true, global: true }),
]);
