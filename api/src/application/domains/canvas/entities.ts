/**
 * Canvas & ideas entities — owned by the **Brain** (PRD 20 §3.2, migration 0429).
 *
 * Two tables, which is the §2.1 session test passing: everything a canvas is —
 * the document, the meeting, the attendees, the recording, the share, the
 * comment thread — is already `creation_session` + kernel primitives. What is
 * left is the stock media a session pulls in and the async interview it records.
 */
import {
  stockMediaAssets,
  studioAsyncInterviews,
} from '../../../infrastructure/database/schema/canvas';
import { defineDomainEntities } from '../entityDefinition';

export const CANVAS_ENTITIES = defineDomainEntities('canvas', [
  stockMediaAssets,
  studioAsyncInterviews,
]);
