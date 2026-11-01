/**
 * The ONLY place the parity harness excuses a difference between two engines' records. Every rule below
 * is named with the reason it is not a behavioural difference. Adding a rule widens what the suite
 * cannot see: a rule that hides something an engine decides is a defect in this file, not a feature.
 *
 *  1. Run ids. `metadata.guestTurnId` is `crypto.randomUUID()` per run (`runPreamble.ts`), so two runs
 *     of one scenario can never share it. Each distinct id becomes `<id:N>` by order of first
 *     appearance, so a run that reuses one id where the other minted two is still seen.
 *  2. Wall-clock instants, by key: `ts`, `createdAt`, `startedAt`, `at`. Both engines stamp `new Date()`.
 *  3. Measured durations, by key: `durationMs`, `ttftMs`, `elapsedMs`. They are timings of the machine,
 *     not decisions. Kept as `<ms>` so a step that has one on one engine and none on the other is seen.
 *  4. ISO-8601 instants inside text (a system prompt's clock line, a step's wording): same as rule 2.
 *
 * Nothing else is normalised: not message order, not step numbers, not counts, not wording.
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// `runPreamble.ts` falls back to `<epoch ms>-<base36>` where `crypto.randomUUID` is absent.
const FALLBACK_ID = /\b\d{13}-[a-z0-9]{6,}\b/g;
const ISO_INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g;

const INSTANT_KEYS = new Set(['ts', 'createdAt', 'startedAt', 'at']);
const DURATION_KEYS = new Set(['durationMs', 'ttftMs', 'elapsedMs']);

/** A normaliser with its own id numbering: one per record, so a record is numbered from 1. */
export function normaliser(): <T>(value: T) => T {
  const ids = new Map<string, number>();
  const idOf = (raw: string): string => {
    let n = ids.get(raw);
    if (n === undefined) { n = ids.size + 1; ids.set(raw, n); }
    return `<id:${n}>`;
  };
  const text = (s: string): string => s.replace(UUID, idOf).replace(FALLBACK_ID, idOf).replace(ISO_INSTANT, '<iso>');
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === 'string') return key && INSTANT_KEYS.has(key) ? '<iso>' : text(v);
    if (typeof v === 'number') return key && DURATION_KEYS.has(key) ? '<ms>' : v;
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (x === undefined) continue;
        out[text(k)] = walk(x, k);
      }
      return out;
    }
    return v;
  };
  return (value) => walk(value) as typeof value;
}

/** Normalise a whole record. */
export function normalise<T>(record: T): T {
  return normaliser()(record);
}
