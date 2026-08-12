/**
 * Integrations entities — owned by **the platform** (PRD 20 §3.2).
 *
 * A vendor is a `connection` row against a manifest entry, so adding Slack,
 * Notion or Xero adds no DDL here. Provider-neutral mailbox automation rules
 * and replies remain domain nouns, while the kernel's `connection`, `credential`
 * and `sync_state` continue to own connector infrastructure.
 *
 * The seat's surface is therefore a view over kernel primitives filtered to this
 * domain, not a table of its own — exactly what a consolidated model is supposed
 * to look like from above.
 */
import {
  mailboxAutomationReplies,
  mailboxAutomationRules,
} from '../../../infrastructure/database/schema/integrations';
import { defineDomainEntities, entity } from '../entityDefinition';

export const INTEGRATIONS_ENTITIES = defineDomainEntities('integrations', [
  entity(mailboxAutomationRules, { readOnly: true }),
  entity(mailboxAutomationReplies, { readOnly: true }),
]);
