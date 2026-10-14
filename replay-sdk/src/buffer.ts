/**
 * Buffer mode (PRD 33 §3, §8 S2): an unkept session keeps only the last
 * `REPLAY_LIMITS.bufferMs` of rrweb events in memory and sends none of them.
 * When a keep trigger fires, the buffer is flushed into the recording so the
 * moments BEFORE the trigger are in it.
 *
 * While buffering, rrweb takes a full snapshot every `bufferMs`
 * (`checkoutEveryNms`). The ring keeps the last two checkout segments, so it
 * always starts at a full snapshot (replayable) and covers at least
 * `bufferMs` of history.
 */

/** Hard ceiling on buffered events, whatever the segment timing. */
export const BUFFER_MAX_EVENTS = 20_000;

export class EventRing {
  private segments: unknown[][] = [[]];
  private lastWasCheckout = false;
  private count = 0;

  /** One rrweb event; `isCheckout` is rrweb's second `emit` argument. */
  push(event: unknown, isCheckout: boolean): void {
    if (isCheckout && !this.lastWasCheckout && this.current().length > 0) {
      this.segments.push([]);
      if (this.segments.length > 2) this.count -= this.segments.shift()!.length;
    }
    this.lastWasCheckout = isCheckout;
    this.current().push(event);
    this.count += 1;
    while (this.count > BUFFER_MAX_EVENTS && this.segments.length > 1) {
      this.count -= this.segments.shift()!.length;
    }
  }

  /** Everything buffered, oldest first; empties the ring. */
  drain(): unknown[] {
    const out = this.segments.flat();
    this.segments = [[]];
    this.lastWasCheckout = false;
    this.count = 0;
    return out;
  }

  get size(): number {
    return this.count;
  }

  private current(): unknown[] {
    return this.segments[this.segments.length - 1]!;
  }
}
