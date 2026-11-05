/**
 * The small pieces every drawer and camera card shares: a KPI, a labelled bar (a `meter`, so
 * assistive tech reads the value), and the honest "not set up" block. Tokens only.
 */

import type { CSSProperties, ReactNode } from 'react';
import { cssVar, type ThemeTone } from '../../scene/themeColors';
import { card, heading, muted } from '../../styles';

export function Kpi({ label, value, tone }: { label: string; value: ReactNode; tone?: ThemeTone }) {
    return (
        <div style={{ ...card, padding: 8, display: 'grid', gap: 2 }}>
            <span style={muted}>{label}</span>
            <strong style={{ fontSize: 18, color: tone ? cssVar(tone) : cssVar('text') }}>{value}</strong>
        </div>
    );
}

export const kpiGrid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 };

/** A horizontal bar filled to `frac` (0 to 1). */
export function Bar({ frac, tone = 'accent', label, height = 6 }: { frac: number; tone?: ThemeTone; label: string; height?: number }) {
    const pct = Math.round(Math.min(1, Math.max(0, frac)) * 100);
    return (
        <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} style={{ height, borderRadius: 999, background: cssVar('plane'), overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: cssVar(tone) }} />
        </div>
    );
}

/** A source that is not set up says so; it never draws a zero. */
export function NotSetUp({ title, body }: { title: string; body: string }) {
    return (
        <section data-state="not-set-up" style={{ ...card, display: 'grid', gap: 6 }}>
            <h3 style={heading}>{title}</h3>
            <p style={{ ...muted, margin: 0 }}>{body}</p>
        </section>
    );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section style={{ display: 'grid', gap: 8 }}>
            <h3 style={heading}>{title}</h3>
            {children}
        </section>
    );
}
