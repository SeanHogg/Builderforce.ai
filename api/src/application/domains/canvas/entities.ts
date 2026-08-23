/**
 * Canvas & ideas entities — owned by the **Brain** (PRD 20 §3.2, migration 0429).
 *
 * Two tables, which is the §2.1 session test passing: everything a canvas is —
 * the document, the meeting, the attendees, the recording, the share, the
 * comment thread — is already `creation_session` + kernel primitives. What is
 * left is the stock media a session pulls in and the async interview it records.
 */
import {
  canvasWidgets,
  creationSessionFolders,
  stockMediaAssets,
  studioAsyncInterviews,
} from '../../../infrastructure/database/schema/canvas';
import { defineDomainEntities, entity } from '../entityDefinition';

export const CANVAS_ENTITIES = defineDomainEntities('canvas', [
  stockMediaAssets,
  studioAsyncInterviews,

  /**
   * A folder a Creation Session is filed into (migration 1118) — readable
   * through the generic surface, never writable through it.
   *
   * `creationSessionFolderRouteService.ts` owns invariants a generic PATCH
   * cannot: the case-insensitive name uniqueness per (tenant, segment) that
   * decides create-vs-return-existing, and that a reassigned `projectId`
   * actually belongs to the same tenant and segment. A generic writer only
   * knows the column exists, not that it must be validated against another
   * tenant-scoped table first — the same reason `canvasWidgets` below is
   * `readOnly`.
   */
  entity(creationSessionFolders, { readOnly: true }),

  /**
   * A registered third-party widget (migration 1101) — readable through the
   * generic surface, never writable through it.
   *
   * Its invariants are not "a valid row". `entry_origin` must be DERIVED from
   * `entry_url` (it is the only origin the browser host accepts a message from),
   * and `permissions` is the set an admin approved. A generic PATCH that could set
   * either one directly would let a caller point a live widget's trust anchor at
   * an origin nobody reviewed, or widen its own grant — which is precisely the
   * case `entityDefinition` reserves `readOnly` for. Writes go through
   * `application/canvas/canvasWidgetService.ts`.
   */
  entity(canvasWidgets, { readOnly: true }),
]);
