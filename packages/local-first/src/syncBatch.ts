/**
 * What a sync push sends: the wire form of each event's `dependsOn`, and the next batch picked
 * from the sendable events (held events last and only once their backoff has passed). Pure: the
 * coordinator (`sync.ts`) reads the store and hands the events in.
 */
import type { JournalEvent } from './records.js';
import { dependencyIndex, resolveDependency } from './dependencyGraph.js';

const jsonBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

/**
 * Put `dependsOn` on the wire as event ids, resolved NOW. A dependency is a logical write's
 * idempotency key (or, in an older stored event, a wire id); it names whichever LIVE pending event
 * currently carries that key, in ANY destination's partition, so a replaced write (a bound row's
 * import dropped and re-queued under a new id) is followed, not stranded. Nothing pending under it
 * means it was acknowledged: the dependency is dropped. Dead-lettered events are not live, and a
 * dependent of one — or of an entity still awaiting its sync-pass bind — is filtered out before
 * this by `unsendableEventIds`. The journal is not rewritten.
 */
export function wireDependencies(
  events: readonly JournalEvent[],
  allPending: readonly JournalEvent[],
  mapped: ReadonlySet<string> = new Set(),
): JournalEvent[] {
  const index = dependencyIndex(allPending, mapped);
  return events.map((event) => {
    const dependsOn: string[] = [];
    for (const dependency of event.dependsOn) {
      const resolved = resolveDependency(dependency, index, event);
      if (resolved.kind !== 'event') continue;
      const wire = resolved.event.eventId;
      if (wire !== event.eventId && !dependsOn.includes(wire)) dependsOn.push(wire);
    }
    return { ...event, dependsOn };
  });
}

/**
 * Pick the next batch. A HELD event (`holdAttempts` > 0: the server answered `dependency_pending`,
 * `conflict` or a non-permanent refusal) is persisted on the journal event, so this holds across
 * coordinators and restarts. Held events are ALWAYS ordered after fresh work, are skipped until
 * their `nextAttemptAt` backoff has passed, and their dependents (transitively) are skipped, since
 * the server would only hold them too. Dead-lettered events are never sent.
 */
export function batchEvents(
  events: readonly JournalEvent[],
  maxEvents: number,
  maxBytes: number,
  at: number,
): { batch: JournalEvent[]; bytes: number } {
  const isHeld = (event: JournalEvent): boolean => (event.holdAttempts ?? 0) > 0;
  const held = new Set(events.filter(isHeld).map((event) => event.eventId));
  const pending = new Set(events.map((event) => event.eventId));
  const behindHeld = new Set<string>();
  for (const event of events) {
    if (event.dependsOn.some((id) => held.has(id) || behindHeld.has(id))) behindHeld.add(event.eventId);
  }
  const ordered = [
    ...events.filter((event) => !held.has(event.eventId)),
    ...events.filter((event) => held.has(event.eventId)),
  ];
  const selected: JournalEvent[] = [];
  const selectedIds = new Set<string>();
  let bytes = 0;
  for (const event of ordered) {
    if (selected.length >= maxEvents) break;
    if (event.deadLetter || behindHeld.has(event.eventId)) continue;
    if (event.nextAttemptAt !== undefined && Date.parse(event.nextAttemptAt) > at) continue;
    if (event.dependsOn.some((id) => pending.has(id) && !selectedIds.has(id))) continue;
    const size = jsonBytes(event);
    if (selected.length > 0 && bytes + size > maxBytes) break;
    if (size > maxBytes) {
      selected.push(event);
      bytes += size;
      break;
    }
    selected.push(event);
    selectedIds.add(event.eventId);
    bytes += size;
  }
  return { batch: selected, bytes };
}
