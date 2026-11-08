import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

/**
 * The y-websocket binary frames a collaboration room speaks. Module scope, so the room and the tests
 * build the same bytes a client would.
 */

/** y-websocket message types. Two, and they are the whole protocol. */
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
/** The sync sub-type that is only a state vector (a request), carrying no document data. */
const SYNC_STEP_1 = 0;

/** The message that ASKS for what the receiver is missing. Sent to every new connection. */
export function encodeSyncStep1(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

/** A document update, wrapped in the sync envelope. */
export function encodeUpdate(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

/** The current awareness state of the named clients. */
export function encodeAwareness(awareness: awarenessProtocol.Awareness, clients: number[]): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, clients));
  return encoding.toUint8Array(encoder);
}

/** Is this a sync frame that carries document data (step 2 or an update), as opposed to a step-1 request? */
export function carriesDocumentData(frame: Uint8Array): boolean {
  const decoder = decoding.createDecoder(frame);
  if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return false;
  return decoding.readVarUint(decoder) !== SYNC_STEP_1;
}

/** Workers hand binary frames over as `ArrayBuffer`; `y-protocols` wants a `Uint8Array`.
 *  One conversion, so no call site has to remember which it is holding. */
export function toBytes(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}
