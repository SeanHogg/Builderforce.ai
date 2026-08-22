/**
 * Agents & runtime entities — owned by **the platform** (PRD 20 §3.2, migration 0426).
 *
 * A run, its steps and its attempts are the kernel's `run` (§2), so what remains
 * here is what the runtime MEASURES and what it CACHES. Almost all of it is
 * written by the runtime itself, which is why most of this file is read-only:
 * a cache row or a usage record edited by hand is a false statement about work
 * that already happened.
 */
import {
  aiCompetitors,
  aiEmailClassifications,
  aiToolCalls,
  aiUsageRecords,
  aiVoiceAgentCalls,
  answerCache,
  agentCapabilityGrants,
  agentContextContributions,
  agentCredentialDelegations,
  agentDefinitionPromotions,
  agentDefinitionReleases,
  agentDefinitionVersions,
  agentOutboundInspections,
  agentRunPrincipals,
  enrichmentCache,
  executionClaimEvidence,
  executionClaims,
  executionLimits,
  geocoderCache,
  llmActionRatings,
  modelLocks,
  skillAssignments,
  workflowActions,
  previewSessions,
} from '../../../infrastructure/database/schema/agents';
import {
  webSearchDocuments,
  webSearchFrontier,
  webSearchRequests,
  webSearchRequestUrls,
  webSearchRobots,
  webSearchSources,
  webSearchTerms,
} from '../../../infrastructure/database/schema/search';
import { defineDomainEntities, entity } from '../entityDefinition';

export const AGENTS_ENTITIES = defineDomainEntities('agents', [
  workflowActions,
  aiCompetitors,
  /** Cost and token accounting. Read it, chart it, never retype it. */
  entity(aiUsageRecords, { readOnly: true }),
  entity(aiToolCalls, { readOnly: true }),
  /** The thumbs a person pressed on a model's work. One row per rater per rated
   *  thing, and the router learns from it — so it is written by the vote
   *  endpoint that enforces that grain and read from everywhere else. A generic
   *  write here would be a vote nobody cast, teaching the router. */
  entity(llmActionRatings, { readOnly: true }),
  entity(aiEmailClassifications, { readOnly: true }),
  entity(aiVoiceAgentCalls, { readOnly: true }),
  /** Caches: keyed by their input, refilled by a miss, expired by their TTL. */
  entity(answerCache, { readOnly: true }),
  entity(enrichmentCache, { readOnly: true }),
  entity(geocoderCache, { readOnly: true }),
  /** A lock is held or it is not. Editing one by hand is how two workers get the
   *  same model at the same time. */
  entity(modelLocks, { readOnly: true }),
  /** Completion provenance is append-only runtime history. */
  entity(executionClaims, { readOnly: true }),
  entity(executionClaimEvidence, { readOnly: true }),
  entity(agentDefinitionVersions, { readOnly: true }),
  entity(agentDefinitionReleases, { readOnly: true }),
  entity(agentDefinitionPromotions, { readOnly: true }),
  entity(agentRunPrincipals, { readOnly: true }),
  entity(agentCapabilityGrants, { readOnly: true }),
  entity(agentCredentialDelegations, { readOnly: true }),
  entity(executionLimits, { readOnly: true }),
  entity(agentContextContributions, { readOnly: true }),
  entity(agentOutboundInspections, { readOnly: true }),
  /** Search crawl state and the derived index are maintained by the crawler. */
  entity(webSearchSources, { readOnly: true }),
  entity(webSearchFrontier, { readOnly: true }),
  entity(webSearchRobots, { readOnly: true, global: true }),
  entity(webSearchDocuments, { readOnly: true }),
  entity(webSearchTerms, { readOnly: true, order: 'term' }),
  entity(webSearchRequests, { readOnly: true }),
  entity(webSearchRequestUrls, { readOnly: true, order: 'frontier_id' }),
  /** A live-preview capacity LEASE: which run currently holds a container instance for
   *  a preview, and why it stopped holding it. Read-only — the lease is opened and
   *  closed by the preview op and the eviction sweep, and hand-editing one is how two
   *  tenants end up believing they hold the same instance. */
  entity(previewSessions, { readOnly: true }),
  /** Which marketplace skills a workspace, or one agent host, may use (migration 1108 —
   *  formerly two tables, one per scope). Writable: assigning a skill is an ordinary
   *  administrative act, and the CHECK plus the two partial unique indexes keep a
   *  hand-made row honest about its scope. `application/skills/skillAssignmentPort` is
   *  what the product uses; this registration is what makes the rows visible to the
   *  generic reader alongside the rest of the agents seat. */
  entity(skillAssignments),
]);
