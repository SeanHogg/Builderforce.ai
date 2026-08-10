/**
 * Commerce entities — owned by **the platform** (PRD 20 §3.2, migration 0425).
 *
 * An order is the root, and §5 step 3 narrowed both checkout tables to order
 * satellites after `check-signature-duplication.mjs` scored them at 0.60 — so
 * the money columns live on the order, and this file has no second copy of them.
 */
import {
  agencyBrandings,
  agencyClients,
  bookingHosts,
  bookingReservations,
  bookingServices,
  cardDecks,
  carts,
  communityResources,
  consultantConsultations,
  consultantKnowledgeDocs,
  exclusiveBoards,
  gigBids,
  gigDisputes,
  gigProjects,
  inboxSeatAddons,
  orderLineItems,
  orders,
  partnerProgramOptIns,
  templateLicenses,
  whitelabelTenants,
} from '../../../infrastructure/database/schema/commerce';
import { defineDomainEntities, entity } from '../entityDefinition';

export const COMMERCE_ENTITIES = defineDomainEntities('commerce', [
  /** Settled money. An order's total is what was charged, and it is corrected by
   *  a refund — another row — not by an edit. */
  entity(orders, { kind: 'order', registers: true, readOnly: true }),
  entity(gigProjects, { kind: 'gig', registers: true }),
  entity(bookingReservations, { kind: 'booking', registers: true }),
  carts,
  entity(orderLineItems, { readOnly: true }),
  templateLicenses,
  whitelabelTenants,
  agencyBrandings,
  agencyClients,
  bookingServices,
  bookingHosts,
  gigBids,
  gigDisputes,
  consultantConsultations,
  consultantKnowledgeDocs,
  cardDecks,
  exclusiveBoards,
  communityResources,
  partnerProgramOptIns,
  inboxSeatAddons,
]);
