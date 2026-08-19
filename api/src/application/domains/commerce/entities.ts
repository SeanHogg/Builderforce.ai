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
  rfpRisks,
  templateLicenses,
  whitelabelTenants,
} from '../../../infrastructure/database/schema/commerce';
// `engagement_milestones` is declared in the canvas context (it hangs off the
// freelance engagement there) but it is a COMMERCE object — what was sold, and
// what has to be delivered for the money to move.
import { engagementMilestones } from '../../../infrastructure/database/schema/canvas';
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
  /** The RFP risk / dependency register (migration 0483). PROJECTED from the
   *  proposal document — `projectRiskRegister` replaces a response's entries on
   *  every regeneration, carrying decided ones over by title — and its lifecycle
   *  is moved by `updateRegisterEntry`, which is what validates a status. A
   *  generic PATCH could repoint `response_id` or rewrite the `title` the carry
   *  matches on, silently reopening a risk the team accepted; so the rows read
   *  through the generic path and are written only by the service that owns
   *  those invariants. Not registered: a register entry is read on the proposal
   *  it belongs to, not navigated to as an object of its own. */
  entity(rfpRisks, { readOnly: true }),
  /**
   * A fixed-price milestone on a freelance engagement (migration 0924).
   *
   * A real object: it has a title, an amount, a due date and a lifecycle a person
   * navigates to and acts on — the reason it was uncovered is that the escrow work
   * landed the table before the catalog entry, not that it resists the generic
   * path. READ-ONLY here because the milestone's state IS the escrow's state:
   * `status` moves only through submit / approve / release, each of which moves
   * money. A generic PATCH that could set `status = 'released'` would release a
   * payment with no release behind it.
   */
  entity(engagementMilestones, { kind: 'milestone', readOnly: true }),
]);
