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
  modelLocks,
  workflowActions,
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
]);
