/**
 * Single-flight — identical work that is already IN FLIGHT is joined, not repeated.
 *
 * PER-ISOLATE BY DESIGN. The in-flight table is a plain `Map<key, flight>` in module
 * state, which is the documented exception to "no ad-hoc Map caches": it holds no
 * VALUES across time (an entry exists only while its promise is pending and is removed
 * the moment it settles), so there is nothing for a TTL to expire and nothing for the
 * read-through cache to store. What it buys is the retry storm / double-submit / fan-out
 * case where N identical requests land on the same isolate within one upstream call.
 *
 * NOT DONE: cross-isolate coalescing. Two isolates (or two colos) racing the same
 * request each make their own call. Joining those would need a Durable Object keyed by
 * the request hash to own the flight — a per-request DO round-trip on the hot path —
 * and the exact-match / semantic caches already absorb the repeat once the first call
 * lands. Deliberately left out.
 *
 * Followers never touch the leader's value directly: `share` hands each one its own
 * copy (a `Response` body can be read once) and is called synchronously when the leader
 * settles, BEFORE the leader's caller can start reading. `share` returning null — or
 * the leader throwing — sends each follower to run the work itself, so a follower is
 * never failed by someone else's abort or error.
 */

interface Flight<T> {
  followers: Array<(shared: T | null) => void>;
}

export class SingleFlight<T> {
  private readonly inflight = new Map<string, Flight<T>>();

  /** How many keys are in flight right now (diagnostics / tests). */
  get size(): number {
    return this.inflight.size;
  }

  /**
   * Run `work` for `key`, or join the flight already running it.
   * `shared` is true when this caller received a follower copy.
   */
  async run(
    key: string,
    work: () => Promise<T>,
    share: (leader: T) => T | null,
  ): Promise<{ value: T; shared: boolean }> {
    const existing = this.inflight.get(key);
    if (existing) {
      const copy = await new Promise<T | null>((resolve) => existing.followers.push(resolve));
      if (copy !== null) return { value: copy, shared: true };
      return { value: await work(), shared: false };
    }

    const flight: Flight<T> = { followers: [] };
    this.inflight.set(key, flight);
    let value: T;
    try {
      value = await work();
    } catch (error) {
      this.settle(key, flight, () => null);
      throw error;
    }
    this.settle(key, flight, () => share(value));
    return { value, shared: false };
  }

  /** Remove the flight and hand every follower its copy — synchronously. */
  private settle(key: string, flight: Flight<T>, copy: () => T | null): void {
    if (this.inflight.get(key) === flight) this.inflight.delete(key);
    for (const resolve of flight.followers) {
      let shared: T | null;
      try {
        shared = copy();
      } catch {
        shared = null;
      }
      resolve(shared);
    }
  }
}
