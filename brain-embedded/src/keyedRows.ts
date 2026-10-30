/**
 * THE decision every message store makes for a row that carries a key (`eventKey`): a row sent AGAIN under the key
 * it was saved with is the SAME row - the saved one comes back and nothing is written (the server upserts on
 * `(chat, event_key)`; the device stores do the same). Pure: the store supplies how to look a key up and how to
 * write a row; this says which rows are known, which are new, and which repeat an earlier row of the same batch.
 * Used by the device store (`localFirstPersistence.ts`) and both Rovr stores (memory and IndexedDB).
 */

export type KeyedSlot<R, M> =
  /** Saved before under this key: return `prior`, write nothing. */
  | { kind: 'known'; prior: M }
  /** Not seen: write it (under `key`, when it has one). */
  | { kind: 'new'; row: R; key: string | undefined }
  /** The same key as an EARLIER row of this batch (`of` is that row's index): return that row's result. */
  | { kind: 'repeat'; of: number };

export function slotKeyedRows<R extends { eventKey?: string }, M>(rows: readonly R[], find: (key: string) => M | undefined): Array<KeyedSlot<R, M>> {
  const firstOf = new Map<string, number>();
  return rows.map((row, index): KeyedSlot<R, M> => {
    const key = row.eventKey;
    if (!key) return { kind: 'new', row, key: undefined };
    const prior = find(key);
    if (prior !== undefined) return { kind: 'known', prior };
    const earlier = firstOf.get(key);
    if (earlier !== undefined) return { kind: 'repeat', of: earlier };
    firstOf.set(key, index);
    return { kind: 'new', row, key };
  });
}
