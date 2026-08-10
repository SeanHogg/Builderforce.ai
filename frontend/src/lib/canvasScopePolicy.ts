/**
 * What a scope change does to the canvas, the live room and the workbench.
 *
 * The gap this closes is not the switcher — `TenantProjectSwitcher` is correctly
 * global. It is that NOTHING decided what a switch meant for an open board or a
 * live call belonging to the workspace you just left: both silently kept
 * rendering, which is undefined behaviour rather than a policy. A third axis
 * (company) adds a third way to get it wrong.
 *
 * One pure function, four axes, read by every surface that reacts to a switch —
 * so the switcher, the live session and the dock cannot each invent their own
 * answer. Pure (no React, no fetch) so the rules are unit-testable as a table.
 *
 * THE DECIDING QUESTION IS "IS THIS AN IDENTITY CHANGE OR A FILTER?"
 *  - tenant  = identity. Different workspace, different data, different room.
 *  - company = a filter INSIDE one identity. Safe as a filter only because of the
 *    `tenant_id NOT NULL` invariant: switching company never crosses an identity
 *    boundary, so no room and no board has to be torn down.
 *  - project = a filter, same treatment.
 *  - canvas  = a mode change on the mounted stage, not a scope change at all.
 */

export type ScopeAxis = 'tenant' | 'company' | 'project' | 'canvas';

/** What happens to the board on the stage. */
export type CanvasEffect =
  /** Untouched. */
  | 'keep'
  /** Stays open, but is now outside the active scope — say so on the board. */
  | 'keep-out-of-scope'
  /** Swap the board inside the mounted stage. */
  | 'swap'
  /** Close it; the new identity's most recent board takes its place. */
  | 'close';

/** What happens to the live call. */
export type RoomEffect = 'keep' | 'leave';

/** What happens to the docked page. */
export type WorkbenchEffect =
  /** Nothing — the destination does not read this axis. */
  | 'keep'
  /** Re-fetch in the new scope, keeping the selected tab. */
  | 'refetch'
  /** Close and reopen on the same destination if it is reachable, else the library. */
  | 'reopen';

export interface ScopeChangeEffect {
  canvas: CanvasEffect;
  room: RoomEffect;
  workbench: WorkbenchEffect;
  /**
   * The switch destroys work in progress and interrupts other people, so it is
   * one of the few legitimate modals. Everything else applies silently.
   */
  confirm: boolean;
  /** i18n key under `scopePolicy` explaining the consequence in the confirm. */
  confirmKey?: string;
}

/**
 * Resolve one scope change.
 *
 * `roomLive` matters only on the tenant axis: without a call, leaving a workspace
 * is not interrupting anyone, so asking for a confirmation would be ceremony.
 */
export function scopeChangeEffect(axis: ScopeAxis, roomLive: boolean): ScopeChangeEffect {
  switch (axis) {
    case 'project':
      // A board linked to another project stays open rather than closing: the
      // person switched a delivery filter, they did not ask to put their work
      // away. The board says it is outside the current project instead.
      return { canvas: 'keep-out-of-scope', room: 'keep', workbench: 'refetch', confirm: false };

    case 'company':
      // Same tenant, so no identity boundary is crossed and the room is
      // untouched. Company-less destinations (Settings, Knowledge) ignore the
      // axis entirely — that is the destination's business, not this policy's.
      return { canvas: 'keep-out-of-scope', room: 'keep', workbench: 'refetch', confirm: false };

    case 'tenant':
      // The one axis that drops a room: it belongs to the workspace being left.
      return {
        canvas: 'close',
        room: roomLive ? 'leave' : 'keep',
        workbench: 'reopen',
        confirm: roomLive,
        confirmKey: roomLive ? 'leaveRoomOnTenantSwitch' : undefined,
      };

    case 'canvas':
      // Not a scope change: the stage stays mounted and the board swaps inside
      // it. The room follows you, and members are told which board you moved to.
      return { canvas: 'swap', room: 'keep', workbench: 'keep', confirm: false };
  }
}
