/**
 * The room's own JSON frames (presence and terminal), which predate the Yjs protocol and are used by
 * surfaces that carry no `Y.Doc`. Pure: what to forward to the other participants, or null to drop.
 */

export interface RelaySender { userId: string; name: string; color: string }

export interface JsonFrame { type: string; [key: string]: unknown }

/** True for a frame that may be dropped when over budget: the next heartbeat corrects it. */
export const isEphemeralJsonFrame = (frame: JsonFrame): boolean => frame.type === 'presence';

/** The text to broadcast for `frame` (received as `raw`), with the sender's identity stamped by the room. */
export function relayableJson(frame: JsonFrame, raw: string, sender: RelaySender): string | null {
  switch (frame.type) {
    case 'yjs-update':
      // The legacy JSON envelope. Relayed rather than applied: it carries no agreed
      // encoding for the update payload, so the room cannot merge it into its own doc
      // without guessing. Clients on the binary protocol — every Yjs client — get the
      // authoritative path.
      return raw;
    case 'presence':
      return JSON.stringify({ ...frame, type: 'presence', userId: sender.userId, name: sender.name, color: sender.color });
    case 'terminal-input':
      return JSON.stringify({ type: 'terminal-input', userId: sender.userId, data: frame.data });
    case 'terminal-output':
      return JSON.stringify({ type: 'terminal-output', data: frame.data });
    default:
      return null;
  }
}
