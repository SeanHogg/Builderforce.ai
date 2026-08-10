/**
 * Integrations entities — owned by **the platform** (PRD 20 §3.2).
 *
 * The domain with ONE target table, and the clearest demonstration of §0: a
 * vendor is a `connection` row against a manifest entry, so adding Slack, Notion
 * or Xero adds no DDL and no entity here. Migration 0410 made that call for
 * connectors before this document existed; the kernel's `connection`,
 * `credential` and `sync_state` are where the rows live, which is why they are
 * declared under `kernel` and not copied into this file.
 *
 * The seat's surface is therefore a view over kernel primitives filtered to this
 * domain, not a table of its own — exactly what a consolidated model is supposed
 * to look like from above.
 */
import { defineDomainEntities } from '../entityDefinition';

export const INTEGRATIONS_ENTITIES = defineDomainEntities('integrations', []);
