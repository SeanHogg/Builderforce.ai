/**
 * THE CANVAS OBJECT — the entity inside the `CanvasBoard` aggregate.
 *
 * ── WHY THIS LIVES HERE AND NOT IN `components/creation-canvas/` ─────────────
 * `lib/canvas/boundedContexts.ts` names `CanvasObject` as a term the canvas
 * context OWNS, and the canvas context's whole claim is that its graph model is
 * browser-native and must not be dragged toward the persistence shape. A type
 * the domain owns cannot be declared in a component file: every domain module
 * would then import upward from presentation, which is the inversion the
 * architecture rules exist to stop, and it is how backend table shapes end up in
 * component props.
 *
 * So this file is the ONE declaration. `components/creation-canvas/types.ts` is
 * a re-export shim carrying the historical names (`CreationNodeData`,
 * `CreationObjectGroup`, `CanvasRosterMember`), which is why its 102 importers
 * did not have to change — a rename is a separate decision from a move, and
 * doing both at once makes the move unreviewable.
 *
 * ── WHY `Node` FROM `@xyflow/react` IS ALLOWED IN THE DOMAIN ─────────────────
 * It is a graph library type, and an anti-corruption layer around it would be
 * ceremony: `Node<Data, 'creation'>` is `{ id, position, data, ... }`, there is
 * no vendor vocabulary to keep out, and translating every object on every render
 * would cost real frames on a 500-object board for no invariant gained. The
 * anti-corruption boundary this context genuinely needs is against PERSISTENCE,
 * and that one is real and enforced — see `boardFromSession` in `canvasBoard.ts`.
 */

import type { Node } from '@xyflow/react';
import type { CreationObjectKind } from '@builderforce/creation-canvas-contract';

export type { CreationObjectKind } from '@builderforce/creation-canvas-contract';

/**
 * What an object on the board HOLDS. Open-ended by design: a kind's authorable
 * fields are declared as data in the object registry, not as a union here, so
 * adding a kind is a registry entry rather than an edit to this type.
 */
export type CanvasObjectData = {
  [key: string]: unknown;
  kind: CreationObjectKind;
  title: string;
  subtitle?: string;
  resourceId?: string;
  status?: string;
  model?: string;
  role?: string;
  focus?: string;
  accent?: string;
  /**
   * How far the object floats off its depth plane in the 3D space, in board
   * pixels. Absent means it sits on whichever layer the graph puts it on.
   */
  depthOffset?: number;
};

/**
 * An object ON the board. Never addressed from outside the aggregate except
 * through the board — that is what naming a root buys, and it is why every
 * operation in `canvasBoard.ts` takes the board rather than a loose node array
 * plus whatever else it needed.
 */
export type CanvasObject = Node<CanvasObjectData, 'creation'>;

/**
 * Palette groups — the sections the object palette is drawn in.
 *
 * Declared beside the object rather than in the registry because two modules
 * need it and the registry imports the other one: `specDerivedRegistry.ts` lowers
 * five spec vocabularies into registry entries and each entry carries its group,
 * so typing that from the registry would be a cycle.
 *
 * `Hiring` is its own group rather than a corner of `People` because the palette
 * is how a kind is FOUND: nine recruiting kinds mixed in with `staff`, `team`,
 * `role` and `standup` is a group nobody scans to the end of, and the two
 * vocabularies are used by different people on different days.
 *
 * `Operations` is its own group for the stronger version of the same reason: it
 * is the only group on this list that holds what a company SELLS rather than how
 * it runs itself, so for a field-service, property, clinical or logistics
 * business it is the group they live in all day and everything else is
 * occasional. Filing a `workOrder` under `Work` beside `prd` and `mockup` would
 * bury the operation inside the software backlog.
 */
export type CanvasObjectGroup =
  | 'Build' | 'Data' | 'Knowledge' | 'Insights' | 'Work' | 'Quality' | 'Teaching' | 'Research'
  | 'Pitch' | 'People' | 'Hiring' | 'Career' | 'Operations' | 'Revenue' | 'Agents' | 'Models' | 'Collaborate' | 'Integrations';

/**
 * Someone on this canvas right now.
 *
 * ONE roster shape, because two surfaces name the same people for two reasons:
 * the conversation shows who is in it, and the play runtime shows who you are
 * playing with and offers the door to invite another. `displayName` is nullable
 * because presence carries an id long before it carries a name, and every
 * consumer has to decide what to draw for an anonymous guest rather than being
 * handed an empty string that looks like one.
 */
export interface CanvasRosterMember {
  userId: string;
  displayName: string | null;
  role: string;
}
