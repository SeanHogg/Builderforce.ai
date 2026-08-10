/**
 * Revenue & CRM entities — owned by the **CRO** (PRD 20 §3.2, migration 0421).
 *
 * `deals` carries the `kind` column §3.3 adjudicated: a sales deal, a recruiter
 * placement fee and an investor allocation are one shape with three kinds, which
 * is why there is one deal entity here and not three.
 */
import {
  businessPhoneNumbers,
  cities,
  communicationTracking,
  contactCompensations,
  contactEducations,
  contactExperiences,
  contactFieldProvenance,
  dealFlowOpportunities,
  deals,
  enrichmentProviderCalls,
  inboxActions,
  lists,
  pipelineStages,
  pipelineTouchpoints,
  riIcps,
  riIds,
  riProspects,
  riSequences,
  savedContactSearches,
  savedSearches,
} from '../../../infrastructure/database/schema/revenue';
import { defineDomainEntities, entity } from '../entityDefinition';

export const REVENUE_ENTITIES = defineDomainEntities('revenue', [
  entity(deals, { kind: 'deal', registers: true }),
  entity(lists, { kind: 'list', registers: true }),
  entity(riSequences, { kind: 'sequence', registers: true }),
  pipelineStages,
  pipelineTouchpoints,
  dealFlowOpportunities,
  contactExperiences,
  contactEducations,
  contactCompensations,
  /** Provenance says which provider asserted a field and when. Editing it
   *  detaches the claim from its source, which is the only thing it records. */
  entity(contactFieldProvenance, { readOnly: true }),
  entity(enrichmentProviderCalls, { readOnly: true }),
  savedSearches,
  savedContactSearches,
  riIcps,
  riIds,
  riProspects,
  /** A tracked send or open is an observation. */
  entity(communicationTracking, { readOnly: true }),
  inboxActions,
  businessPhoneNumbers,
  /** A global place catalogue, not tenant data — readable everywhere, written
   *  by the importer that maintains it. */
  entity(cities, { readOnly: true, global: true }),
]);
