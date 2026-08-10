/**
 * Governance & security entities — owned by **Security** (PRD 20 §3.2,
 * migration 0428).
 *
 * Two tables, both evidence. A legal acceptance is what somebody agreed to and
 * when; a WebAuthn challenge is a one-time nonce the authenticator consumed.
 * Neither is editable by anyone, through any surface — that is the whole point
 * of recording them.
 */
import {
  legalDocumentAcceptances,
  webauthnChallenges,
} from '../../../infrastructure/database/schema/governance';
import { defineDomainEntities, entity } from '../entityDefinition';

export const GOVERNANCE_ENTITIES = defineDomainEntities('governance', [
  entity(legalDocumentAcceptances, { readOnly: true }),
  entity(webauthnChallenges, { readOnly: true }),
]);
