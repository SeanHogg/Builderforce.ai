/**
 * RE-EXPORT SHIM. The declarations moved to `domains/canvas/domain/canvasObject.ts`.
 *
 * They had to move: every domain module needs the object type, and a domain that
 * imports it from `components/` imports upward from presentation — the inversion
 * the architecture rules exist to stop. The names stay here, spelled the way they
 * have always been spelled, because 102 modules import them and a rename is a
 * separate decision from a move. Doing both in one change makes the move
 * unreviewable and every one of those 102 a place to check.
 *
 * `CanvasObjectData` is the domain's name for `CreationNodeData`, and the two are
 * the same type rather than two copies of one shape. New code should import from
 * the domain; this file exists so old code did not have to be touched to let it.
 */

export type {
  CreationObjectKind,
  CanvasObjectData as CreationNodeData,
  CanvasObjectGroup as CreationObjectGroup,
  CanvasRosterMember,
} from '@/domains/canvas/domain/canvasObject';
