/**
 * WHAT THE SERVER SAID ABOUT A BOARD — read from the store, never from an HTTP response.
 *
 * Studio no longer calls `POST /claim`; a board reaches the server as journal events, and the
 * server's answer comes back as a receipt and a mapping. Two facts matter to the surfaces:
 *
 *   - ACCEPTED: the board has a server mapping. That is when "what I was working on" may point at it
 *     (`rememberLastCanvas`) — not when the bind was merely enqueued.
 *   - REFUSED FOR THE PLAN: the board's creating event came back `rejected` with the workspace's
 *     session-quota code. The board stays on the device, unbound-pending, and the existing upgrade UI
 *     (`UpgradeModal`) is shown from this fact. An upgrade lets the same held event through.
 */

import type { EntityDestination, LocalFirstStore } from '@builderforce/local-first';
import { CANVAS_BOARD } from './boardRecords';

/** The code the canvas importer answers with when the workspace is over its saved-board limit. */
export const BOARD_PLAN_LIMIT_CODE = 'CREATION_SESSION_QUOTA';

/** Whether the server has accepted this board (it holds a mapping for it). */
export async function isBoardAccepted(store: LocalFirstStore, boardId: string, destination: EntityDestination): Promise<boolean> {
  return store.read(async (tx) => (await tx.mapping(CANVAS_BOARD, boardId, destination)) !== undefined);
}

/** Whether the board's creation was refused for the workspace's plan, and not accepted since. */
export async function isBoardPlanLimited(store: LocalFirstStore, boardId: string, destination: EntityDestination): Promise<boolean> {
  if (await isBoardAccepted(store, boardId, destination)) return false;
  const { receipts } = await store.export();
  return receipts.some((receipt) =>
    receipt.entityType === CANVAS_BOARD
    && receipt.clientEntityId === boardId
    && receipt.status === 'rejected'
    && (receipt.detail ?? '').includes(BOARD_PLAN_LIMIT_CODE));
}
