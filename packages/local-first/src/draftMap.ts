/**
 * A copy-on-write overlay over a committed `Map`.
 *
 * A transaction used to re-index the WHOLE committed store into five fresh Maps just to
 * have somewhere to write. This overlay holds only what the transaction changed; reads
 * consult it first and fall through to the long-lived committed Map, and `publish`
 * folds it into that Map in one synchronous step.
 *
 * Iteration order is the plain `Map` order a copy-and-mutate would have produced: a key
 * that was overwritten keeps its position, a new key goes last, and a committed key that
 * was deleted and set again goes last too (`relocated`).
 */

type Change<V> =
  | { readonly deleted: true }
  | { readonly deleted: false; readonly value: V; readonly relocated: boolean };

export class DraftMap<V> {
  private readonly changes = new Map<string, Change<V>>();

  constructor(private readonly base: ReadonlyMap<string, V>) {}

  get(key: string): V | undefined {
    const change = this.changes.get(key);
    if (!change) return this.base.get(key);
    return change.deleted ? undefined : change.value;
  }

  has(key: string): boolean {
    const change = this.changes.get(key);
    return change ? !change.deleted : this.base.has(key);
  }

  set(key: string, value: V): void {
    const change = this.changes.get(key);
    if (change && !change.deleted) {
      this.changes.set(key, { deleted: false, value, relocated: change.relocated });
    } else if (change) {
      // Deleted in this draft and set again: it was a committed key (otherwise the
      // delete would have dropped the entry), so it moves to the end.
      this.changes.delete(key);
      this.changes.set(key, { deleted: false, value, relocated: true });
    } else {
      this.changes.set(key, { deleted: false, value, relocated: false });
    }
  }

  delete(key: string): boolean {
    const change = this.changes.get(key);
    if (change) {
      if (change.deleted) return false;
      // A key the draft added and removes again leaves no trace; a committed one stays deleted.
      if (this.base.has(key)) this.changes.set(key, { deleted: true });
      else this.changes.delete(key);
      return true;
    }
    if (!this.base.has(key)) return false;
    this.changes.set(key, { deleted: true });
    return true;
  }

  /** Values in iteration order. Synchronous, so the committed Map cannot move under it. */
  *values(): IterableIterator<V> {
    // A read, or a transaction that has not written this map yet: nothing to merge.
    if (this.changes.size === 0) {
      yield* this.base.values();
      return;
    }
    for (const [key, value] of this.base) {
      const change = this.changes.get(key);
      if (!change) yield value;
      else if (!change.deleted && !change.relocated) yield change.value;
    }
    for (const [key, change] of this.changes) {
      if (change.deleted) continue;
      if (change.relocated || !this.base.has(key)) yield change.value;
    }
  }

  /** Keys removed from the committed Map (including the ones that were set again). */
  *removedKeys(): IterableIterator<string> {
    for (const [key, change] of this.changes) {
      if (change.deleted || change.relocated) yield key;
    }
  }

  /**
   * Whether `key` lands in the draft's TAIL iteration (`values`): it was set fresh
   * (a new key, or a committed key deleted and set again — relocated). The committed
   * base does not yield it, so a typed scan over the base must skip it and visit it
   * here, exactly where `values` would, to preserve `list` order.
   */
  isTailKey(key: string): boolean {
    const change = this.changes.get(key);
    return !!change && !change.deleted && (change.relocated || !this.base.has(key));
  }

  /** Values written, with their keys, in the order they land. */
  *upserts(): IterableIterator<[string, V]> {
    for (const [key, change] of this.changes) {
      if (!change.deleted) yield [key, change.value];
    }
  }
}
