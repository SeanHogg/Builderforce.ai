/**
 * Investor & portfolio entities — owned by the **CEO** (PRD 20 §3.2, migration 0422).
 *
 * The four registered kinds match the seat's manifest: a company, a product, a
 * data room and an opportunity are the things a person opens; checklists,
 * documents and comparables hang off them.
 */
import {
  companies,
  dataRoomShares,
  dataRooms,
  dueDiligenceChecklists,
  dueDiligenceDocuments,
  investmentOpportunities,
  investorPeerComparables,
  modules,
  productIdeas,
  products,
  scratchPadAttachments,
  validationDashboards,
  validationDataImports,
} from '../../../infrastructure/database/schema/investor';
import { defineDomainEntities, entity } from '../entityDefinition';

export const INVESTOR_ENTITIES = defineDomainEntities('investor', [
  /**
   * The listing decision and the two provenance stamps are written by named
   * transitions in `application/investor/startupListing.ts` (PRD 19 B2) — the
   * publish gate refuses an incomplete profile, and a stamp is only meaningful
   * if the thing it stamps happened. Readable here; writable only there.
   */
  entity(companies, { kind: 'company', registers: true, guarded: ['is_publicly_listed', 'listed_at', 'finance_declared_at'] }),
  entity(products, { kind: 'product', registers: true }),
  entity(dataRooms, { kind: 'data_room', registers: true }),
  /**
   * READ-ONLY through the generic path, for the same reason the signature and
   * legal-document share entities are: minting one sends an NDA and mints a
   * credential whose plaintext exists for exactly one response, and revoking one
   * is a decision with an audit trail. Every write goes through
   * `dataRoomSharing.ts`; this registration gives the grant metadata a seat on
   * `canvas_read_domain` and the entity browser and nothing more.
   */
  entity(dataRoomShares, { kind: 'data_room_share', readOnly: true }),
  entity(investmentOpportunities, { kind: 'opportunity', registers: true }),
  productIdeas,
  dueDiligenceChecklists,
  dueDiligenceDocuments,
  investorPeerComparables,
  validationDashboards,
  /** An import is a record of what arrived. Re-run it rather than edit it. */
  entity(validationDataImports, { readOnly: true }),
  scratchPadAttachments,
  modules,
]);
