/**
 * Field-operations entities — owned by **Operations** (PRD 20 §3.2, migration 0464).
 *
 * `work_orders` is the root and the thing a person navigates to; `service_assets`,
 * `service_agreements` and `operations_incidents` register alongside it because each
 * has a life of its own that somebody opens directly — an asset outlives every job
 * done to it, an agreement is a renewal conversation, and an incident is a file that
 * is reopened months later. Everything else is a satellite reached through them.
 */
import {
  assetInspections,
  inboundShipments,
  inventoryItems,
  operationsIncidents,
  operationsSuppliers,
  operatorCertifications,
  purchaseOrders,
  serviceAgreements,
  serviceAssets,
  workEstimates,
  workOrderVisits,
  workOrders,
} from '../../../infrastructure/database/schema/operations';
import { defineDomainEntities, entity } from '../entityDefinition';

export const OPERATIONS_ENTITIES = defineDomainEntities('operations', [
  entity(workOrders, { kind: 'work_order', registers: true }),
  entity(serviceAssets, { kind: 'service_asset', registers: true }),
  entity(serviceAgreements, { kind: 'service_agreement', registers: true }),
  entity(operationsIncidents, { kind: 'incident', registers: true }),
  entity(workOrderVisits, { kind: 'visit' }),
  /** `work_estimates`, not `estimates` — `task_effort_estimates` in `delivery` is a
   *  different noun entirely. The kind is the word the trade uses. */
  entity(workEstimates, { kind: 'estimate' }),
  entity(assetInspections, { kind: 'inspection' }),
  entity(operatorCertifications, { kind: 'certification' }),
  entity(inventoryItems, { kind: 'inventory_item' }),
  entity(operationsSuppliers, { kind: 'supplier' }),
  /**
   * READ-ONLY through the generic writer. A purchase order commits money, and
   * `approved_by_ref` / `approved_at` are the record that somebody with authority
   * did so — a generic PATCH that can set them is an approval anybody can assert.
   * The same rule `placement_splits` and the kernel's ledger already follow.
   */
  entity(purchaseOrders, { kind: 'purchase_order', readOnly: true }),
  entity(inboundShipments, { kind: 'shipment' }),
]);
