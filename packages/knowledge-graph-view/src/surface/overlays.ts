/**
 * Overlays: which metric a station's visual channel shows (PRD 38, Option B+). The metrics,
 * the channels (colour, size, ring, width, pulse, outline, pins), the four presets and the
 * bindings are DATA here; every view reads the same bindings through {@link makeOverlay}, so
 * "Risk" colours the transit map, the tower and the heat grid the same way.
 *
 * A metric whose data is absent (no coverage file, no history) is `not-set-up`: its channel
 * draws neutral and reports the state so the UI can say so. It never draws zeros.
 */

import type { ThemeTone } from '../scene/themeColors';
import { cmp } from '../order';
import type { Station } from './stations';

export type MetricId = 'anti' | 'cx' | 'cov' | 'use' | 'churn' | 'coupling' | 'changed' | 'owner' | 'none';
export type ChannelId = 'colour' | 'size' | 'ring' | 'width' | 'pulse' | 'outline';
export type PresetId = 'risk' | 'quality' | 'activity' | 'ownership';

export const METRICS: readonly MetricId[] = ['anti', 'cx', 'cov', 'use', 'churn', 'coupling', 'changed', 'owner', 'none'];

/**
 * The metrics that read a station field relative to the busiest station (0–1, undefined = no data collected). Each is ONE row:
 * its status, its level and its fraction all come from the field. `coupling` is PRD 38 P4's hidden coupling (memory's
 * `coChangeHidden` badge: co-change partners with no reference edge), summed over the station's files.
 */
export const RELATIVE_METRICS: Partial<Record<MetricId, (s: Station) => number | undefined>> = {
    churn: (s) => s.churn,
    coupling: (s) => s.coupling,
};

export interface Bindings extends Record<ChannelId, MetricId> {
    pins: 'on' | 'off';
}

export interface ChannelDef {
    id: ChannelId;
    /** The metrics this channel may show (owner is a colour; "changed" has no width). */
    allows(metric: MetricId): boolean;
}

export const CHANNELS: readonly ChannelDef[] = [
    { id: 'colour', allows: () => true },
    { id: 'size', allows: (m) => m !== 'owner' },
    { id: 'ring', allows: (m) => m !== 'owner' },
    { id: 'width', allows: (m) => m !== 'owner' && m !== 'changed' },
    { id: 'pulse', allows: (m) => m !== 'owner' },
    { id: 'outline', allows: (m) => m !== 'owner' },
];

export const PRESETS: Record<PresetId, Bindings> = {
    risk: { colour: 'anti', size: 'cx', ring: 'cov', width: 'use', pulse: 'changed', outline: 'none', pins: 'on' },
    quality: { colour: 'cov', size: 'cx', ring: 'cov', width: 'use', pulse: 'none', outline: 'cov', pins: 'on' },
    activity: { colour: 'churn', size: 'use', ring: 'churn', width: 'use', pulse: 'changed', outline: 'none', pins: 'off' },
    ownership: { colour: 'owner', size: 'churn', ring: 'cov', width: 'use', pulse: 'none', outline: 'none', pins: 'on' },
};
export const PRESET_ORDER: readonly PresetId[] = ['risk', 'quality', 'activity', 'ownership'];

/** The preset whose bindings these are exactly, or 'custom'. */
export function presetOf(b: Bindings): PresetId | 'custom' {
    return PRESET_ORDER.find((id) => (Object.keys(PRESETS[id]) as Array<keyof Bindings>).every((k) => PRESETS[id][k] === b[k])) ?? 'custom';
}

export function setChannel(b: Bindings, channel: ChannelId, metric: MetricId): Bindings {
    return { ...b, [channel]: metric };
}

export const SEVERITY_TONES = ['sev1', 'sev2', 'sev3', 'sev4', 'sev5'] as const satisfies readonly ThemeTone[];
export const LINE_TONES = ['line1', 'line2', 'line3', 'line4', 'line5', 'line6', 'line7', 'line8'] as const satisfies readonly ThemeTone[];

export const lineTone = (index: number): ThemeTone => LINE_TONES[index % LINE_TONES.length]!;

export type MetricStatus = 'ready' | 'not-set-up';

/** Whether any station reports the metric. Anti-patterns, usage and changed are always computable. */
export function metricStatus(metric: MetricId, stations: readonly Station[]): MetricStatus {
    const has = (pick: (s: Station) => unknown) => stations.some((s) => pick(s) !== undefined);
    switch (metric) {
        case 'cx': return has((s) => s.cx) ? 'ready' : 'not-set-up';
        case 'cov': return has((s) => s.cov) ? 'ready' : 'not-set-up';
        case 'owner': return has((s) => s.owner) ? 'ready' : 'not-set-up';
        default: { const read = RELATIVE_METRICS[metric]; return !read || has(read) ? 'ready' : 'not-set-up'; }
    }
}

/** 1 (good) to 5 (bad) for a station; undefined when the station has no data for the metric. */
export function level5(metric: MetricId, s: Station): number | undefined {
    switch (metric) {
        case 'anti': return s.anti;
        case 'cx': return s.cx;
        case 'cov': return s.cov === undefined ? undefined : 5 - Math.round(s.cov * 4);
        case 'use': return Math.round(s.use * 4) + 1;
        case 'changed': return s.changed ? 5 : 1;
        default: { const f = RELATIVE_METRICS[metric]?.(s); return f === undefined ? undefined : Math.round(f * 4) + 1; }
    }
}

/** 0–1 for a station; undefined when there is no data (or the metric is not a fraction). */
export function frac(metric: MetricId, s: Station): number | undefined {
    switch (metric) {
        case 'cov': return s.cov;
        case 'use': return s.use;
        case 'anti': return (s.anti - 1) / 4;
        case 'cx': return s.cx === undefined ? undefined : (s.cx - 1) / 4;
        case 'changed': return s.changed ? 1 : 0;
        default: return RELATIVE_METRICS[metric]?.(s);
    }
}

export interface StationStyle {
    tone: ThemeTone;
    /** Marker radius. */
    size: number;
    /**
     * null = no reading (the station has no data for the ring metric: no fill, and no shell either - the legend says why).
     * `zeroCoverage`: the ring is the coverage metric and it MEASURED 0% (not "no data"); the Tower draws that as a dashed shell.
     */
    ring: { frac: number; tone: ThemeTone; zeroCoverage?: boolean } | null;
    pulse: boolean;
    outline: boolean;
}

export type ChannelStatus = MetricStatus | 'off';

export interface OverlayModel {
    bindings: Bindings;
    /** Per channel: ready, not set up (its metric has no data anywhere), or off. */
    status: Record<ChannelId, ChannelStatus>;
    style(s: Station): StationStyle;
    /** A line's drawn width from the stations it stops at. */
    lineWidth(stops: readonly Station[]): number;
}

export const NEUTRAL_SIZE = 8;

/** Good coverage reads healthy, thin reads caution, none reads bad. */
export const coverageTone = (f: number): ThemeTone => (f >= 0.7 ? 'agrees' : f > 0 ? 'cycle' : 'violation');

export function makeOverlay(bindings: Bindings, stations: readonly Station[]): OverlayModel {
    const status = Object.fromEntries(CHANNELS.map(({ id }) => [id, bindings[id] === 'none' ? 'off' : metricStatus(bindings[id], stations)])) as Record<ChannelId, ChannelStatus>;
    const ready = (c: ChannelId) => status[c] === 'ready';
    const owners = [...new Set(stations.map((s) => s.owner).filter((o): o is string => !!o))].sort(cmp);
    const high = (c: ChannelId, s: Station) => ready(c) && (level5(bindings[c], s) ?? 0) >= 4;

    return {
        bindings, status,
        style(s) {
            let tone: ThemeTone = 'edge';
            if (ready('colour')) {
                if (bindings.colour === 'owner') tone = s.owner ? lineTone(owners.indexOf(s.owner)) : 'edge';
                else { const l = level5(bindings.colour, s); if (l !== undefined) tone = SEVERITY_TONES[l - 1]!; }
            }
            const sizeLevel = ready('size') ? level5(bindings.size, s) : undefined;
            const f = ready('ring') ? frac(bindings.ring, s) : undefined;
            return {
                tone,
                size: sizeLevel === undefined ? NEUTRAL_SIZE : 5 + sizeLevel * 2,
                ring: f === undefined ? null : { frac: f, tone: bindings.ring === 'cov' ? coverageTone(f) : 'accent', ...(bindings.ring === 'cov' && f === 0 ? { zeroCoverage: true } : {}) },
                pulse: high('pulse', s),
                outline: high('outline', s),
            };
        },
        lineWidth(stops) {
            if (!ready('width')) return 6;
            const values = stops.map((s) => frac(bindings.width, s)).filter((v): v is number => v !== undefined);
            // No reading on any stop: the neutral width, never an invented mid value.
            return values.length ? 5 + 7 * (values.reduce((a, b) => a + b, 0) / values.length) : 6;
        },
    };
}

/** Whether a segment between two stations is untested: undefined when neither reports coverage. */
export function segmentUntested(from: Station, to: Station): boolean | undefined {
    const known = [from.cov, to.cov].filter((v): v is number => v !== undefined);
    return known.length === 0 ? undefined : Math.min(...known) < 0.5;
}
