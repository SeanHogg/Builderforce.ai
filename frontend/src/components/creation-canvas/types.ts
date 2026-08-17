export type { CreationObjectKind } from '@builderforce/creation-canvas-contract';
import type { CreationObjectKind } from '@builderforce/creation-canvas-contract';

export type CreationNodeData = {
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
 * Palette groups — the sections the object palette is drawn in.
 *
 * Declared here rather than in `creationObjectRegistry.ts` because two modules need it
 * and the registry imports the other one: `specDerivedRegistry.ts` lowers five spec
 * vocabularies into registry entries and each entry carries its group, so typing that
 * from the registry would be a cycle. `types.ts` is what both already import.
 *
 * `Hiring` is its own group rather than a corner of `People` because the palette is how
 * a kind is FOUND: nine recruiting kinds mixed in with `staff`, `team`, `role` and
 * `standup` is a group nobody scans to the end of, and the two vocabularies are used by
 * different people on different days.
 *
 * `Operations` is its own group for the stronger version of the same reason: it is the
 * only group on this list that holds what a company SELLS rather than how it runs itself,
 * so for a field-service, property, clinical or logistics business it is the group they
 * live in all day and everything else is occasional. Filing a `workOrder` under `Work`
 * beside `prd` and `mockup` would bury the operation inside the software backlog.
 */
export type CreationObjectGroup =
  | 'Build' | 'Data' | 'Knowledge' | 'Insights' | 'Work' | 'Quality' | 'Teaching' | 'Research'
  | 'Pitch' | 'People' | 'Hiring' | 'Operations' | 'Agents' | 'Models' | 'Collaborate' | 'Integrations';

/**
 * Someone on this canvas right now.
 *
 * ONE roster shape, because two surfaces name the same people for two reasons: the
 * conversation shows who is in it, and the play runtime shows who you are playing with
 * and offers the door to invite another. `displayName` is nullable because presence
 * carries an id long before it carries a name, and every consumer has to decide what to
 * draw for an anonymous guest rather than being handed an empty string that looks like
 * one.
 */
export interface CanvasRosterMember {
  userId: string;
  displayName: string | null;
  role: string;
}
