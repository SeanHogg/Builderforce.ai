/**
 * Legal entities — owned by **Counsel** (migration 0469).
 *
 * The seventeenth seat, and the first one added because a whole PHASE of a
 * company's life had no owner rather than because a feature needed a home.
 * `governance` is SOC 2 and belongs to Security: controls, findings, policies,
 * evidence — the compliance posture of a company that already exists. Nothing
 * owned incorporating it, appointing a registered agent, qualifying in a second
 * state, assigning the founders' IP, filing a mark, or renewing any of those on a
 * clock.
 *
 * Four entities, plus the co-founder matching that leads to the first of them.
 * Everything else a legal function touches is already somewhere: the
 * counterparty is a `party_role`, the agreement is a `contract` object over the
 * kernel's signature primitives, the executed copy is an `artifact`, and a
 * renewal warning is a `trigger` over a declared deadline field.
 */
import {
  cofounderIntroductions,
  cofounderProfiles,
  intellectualProperty,
  legalEntities,
  legalMatters,
  legalRegistrations,
} from '../../../infrastructure/database/schema/legal';
import { defineDomainEntities, entity } from '../entityDefinition';

export const LEGAL_ENTITIES = defineDomainEntities('legal', [
  /** The root: the company itself, and every subsidiary. */
  entity(legalEntities, { kind: 'legal_entity', registers: true, title: 'legal_name' }),
  entity(legalRegistrations, { kind: 'registration' }),
  entity(intellectualProperty, { kind: 'ip_asset', registers: true }),
  entity(legalMatters, { kind: 'matter', registers: true }),
  /**
   * A co-founder profile is writable by its owner and READ cross-tenant, which is
   * the pair that makes the whole surface work: discovery has to see other
   * workspaces or there is nobody to meet. `visibility` is the access predicate
   * the cross-tenant read carries, and the discovery query declares it through
   * `acrossTenants` rather than dropping the filter silently.
   */
  cofounderProfiles,
  /**
   * READ-ONLY through the generic path. An introduction's `status` is one party's
   * ANSWER to another party's request, and a generic PATCH that could set it to
   * `accepted` would let a workspace record somebody else's agreement — the same
   * defect the signature entities are read-only for, in a smaller currency.
   */
  entity(cofounderIntroductions, { kind: 'introduction', readOnly: true }),
]);
