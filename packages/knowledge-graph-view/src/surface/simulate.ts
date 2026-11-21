/**
 * Simulate-with-values, as a pure step model. Nothing is executed.
 *
 * Given the values entered at an entry point and the hops of a journey (the path strip) or a
 * trace (the same `{ from, to, kind }` steps `TracePanel` draws from `traceGraph`), each hop
 * carries the values known when it is crossed. A hop may `produce` a value: that value is
 * carried on the hops after it, not on itself. Entry values flow through every hop.
 */

export interface CarriedValue {
    name: string;
    value: string;
}

/** One hop of a journey or a trace step (`TracePanel`'s `trace.steps`). */
export interface JourneyHop {
    from: string;
    to: string;
    kind?: string;
    /** A value this hop produces. Carried from the next hop on. */
    produces?: CarriedValue;
}

export interface HopCarry {
    index: number;
    from: string;
    to: string;
    kind?: string;
    /** Values carried across this hop, entry values first, then earlier productions. */
    carried: CarriedValue[];
}

export interface SimulateRequest {
    /** Entry-point input values, in the order they were entered. A later row with the same name wins. */
    values: readonly CarriedValue[];
    hops: readonly JourneyHop[];
}

const named = (v: CarriedValue | undefined): v is CarriedValue => !!v && v.name.trim().length > 0;

/** Copy `values`, last write per name winning, without mutating the input. */
function seed(values: readonly CarriedValue[]): CarriedValue[] {
    const out: CarriedValue[] = [];
    const at = new Map<string, number>();
    for (const v of values) {
        if (!named(v)) continue;
        const row = { name: v.name, value: v.value };
        const i = at.get(row.name);
        if (i === undefined) { at.set(row.name, out.length); out.push(row); }
        else out[i] = row;
    }
    return out;
}

/**
 * The values carried across each hop. Entry values are on every hop; a hop's `produces` is on
 * the hops that follow it. The input arrays are not mutated.
 */
export function simulate({ values, hops }: SimulateRequest): HopCarry[] {
    const carried = seed(values);
    const at = new Map(carried.map((v, i) => [v.name, i] as const));
    return hops.map((hop, index) => {
        const snapshot = carried.map((v) => ({ name: v.name, value: v.value }));
        if (named(hop.produces)) {
            const row = { name: hop.produces.name, value: hop.produces.value };
            const i = at.get(row.name);
            if (i === undefined) { at.set(row.name, carried.length); carried.push(row); }
            else carried[i] = row;
        }
        return { index, from: hop.from, to: hop.to, ...(hop.kind ? { kind: hop.kind } : {}), carried: snapshot };
    });
}

/** Trace steps as `TracePanel` draws them → journey hops. Trace-only fields (`verdict`, `cycle`, `back`) are dropped. */
export function hopsFromTrace(steps: readonly { from: string; to: string; kind?: string }[]): JourneyHop[] {
    return steps.map((s) => ({ from: s.from, to: s.to, ...(s.kind ? { kind: s.kind } : {}) }));
}

/** Adjacent journey stops → hops. `kinds` is indexed like the path strip's `hops` (one per pair). */
export function hopsFromStops(stops: readonly { id: string }[], kinds?: readonly (string | undefined)[]): JourneyHop[] {
    const hops: JourneyHop[] = [];
    for (let i = 0; i < stops.length - 1; i++) {
        const kind = kinds?.[i];
        hops.push({ from: stops[i]!.id, to: stops[i + 1]!.id, ...(kind ? { kind } : {}) });
    }
    return hops;
}

/** The hops that leave `entry` (a stop id or a trace ref). Unknown entry ⇒ the hops unchanged. */
export function hopsFromEntry(hops: readonly JourneyHop[], entry: string): JourneyHop[] {
    if (!entry) return [...hops];
    const at = hops.findIndex((h) => h.from === entry);
    return at >= 0 ? hops.slice(at) : [...hops];
}
