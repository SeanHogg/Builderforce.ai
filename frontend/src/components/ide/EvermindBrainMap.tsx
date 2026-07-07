'use client';

/**
 * EvermindBrainMap — the center-stage visualization for the `llm` build modality.
 *
 * It renders the project's Evermind as a brain: a central core wired to four
 * regions of knowledge — Cortex (reasoning), Hippocampus (episodic memory),
 * Limbic (affect/tone) and Personality (stable traits) — and grows a live graph
 * of the knowledge each region is learning as agents run and teaching lands.
 *
 * Every node is real: the graph is derived from the SAME server-cached
 * `/evermind/contributions` payload the training console reads, so nothing here is
 * fabricated. `delta` contributions (weight deltas from runs) flow into the Cortex;
 * `text` contributions (taught transcripts / run text) consolidate in the
 * Hippocampus; the Limbic and Personality regions reflect the model's teacher/mode
 * and seeded-identity state. The component self-gates (its own loading / dormant /
 * error states), polls lightly so the graph stays live, and themes entirely through
 * cascading CSS variables so it reads natively in both light and dark. Region hues
 * are the validated categorical slots (blue / aqua / magenta / violet); every region
 * carries an always-visible label, so identity is never colour-alone.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  getProjectEvermindContributions,
  type ProjectEvermindContributions,
  type ProjectEvermindRecentEntry,
} from '@/lib/projectEvermindApi';

/* ── Geometry (SVG user units; the viewBox scales to the container) ──────────── */
const VB_W = 820;
const VB_H = 560;
const CORE = { x: VB_W / 2, y: VB_H / 2 };
const CORE_R = 44;

type RegionKey = 'cortex' | 'hippocampus' | 'limbic' | 'personality';

interface RegionMeta {
  key: RegionKey;
  /** Anchor point of the region node, laid out like brain lobes around the core. */
  x: number;
  y: number;
  /** CSS variable carrying the region's themed hue. */
  varName: string;
}

const REGIONS: RegionMeta[] = [
  { key: 'personality', x: 210, y: 150, varName: '--ev-personality' },
  { key: 'cortex', x: 610, y: 150, varName: '--ev-cortex' },
  { key: 'limbic', x: 210, y: 410, varName: '--ev-limbic' },
  { key: 'hippocampus', x: 610, y: 410, varName: '--ev-hippocampus' },
];

/** Max knowledge nodes drawn per region before we summarise the remainder. */
const MAX_NODES_PER_REGION = 18;
const GOLDEN = 2.399963; // radians — even, stable fan-out with no RNG

/** A learned contribution positioned around its region. */
interface KnowledgeNode {
  id: string;
  region: RegionKey;
  x: number;
  y: number;
  r: number;
  fresh: boolean;
  entry: ProjectEvermindRecentEntry;
}

/** Deterministically fan `entries` out around a region centre (stable across polls). */
function layoutRegionNodes(
  region: RegionMeta,
  entries: ProjectEvermindRecentEntry[],
  freshCutoffAt: number,
): KnowledgeNode[] {
  const shown = entries.slice(0, MAX_NODES_PER_REGION);
  return shown.map((entry, i) => {
    const angle = i * GOLDEN;
    const ring = 58 + (i % 3) * 20;
    // Bias the fan toward the core so clusters read as "wired in", not scattered.
    const towardCore = Math.atan2(CORE.y - region.y, CORE.x - region.x);
    const spread = towardCore + Math.PI + (angle - Math.PI); // centre the arc away from core
    return {
      id: `${region.key}-${entry.version}-${entry.at}-${i}`,
      region: region.key,
      x: region.x + Math.cos(spread) * ring,
      y: region.y + Math.sin(spread) * ring,
      r: 6 + Math.min(4, Math.max(0, entry.weight - 1)),
      fresh: entry.at >= freshCutoffAt,
      entry,
    };
  });
}

interface RegionState {
  meta: RegionMeta;
  /** 0..1 charge driving ring fill + node radius. */
  charge: number;
  /** Human count shown on the region chip. */
  count: number;
  nodes: KnowledgeNode[];
  overflow: number;
  /** Whether the core→region edge should animate (this region is actively learning). */
  active: boolean;
  /** Short state caption (e.g. "Guided by …", "3 consolidating"). */
  caption: string;
}

export function EvermindBrainMap({ projectId }: { projectId: number }) {
  const t = useTranslations('evermindBrain');
  const [data, setData] = useState<ProjectEvermindContributions | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const inFlight = useRef(false);

  const reload = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const d = await getProjectEvermindContributions(projectId);
      setData(d);
      setError(false);
    } catch {
      setError(true);
    } finally {
      inFlight.current = false;
      setLoaded(true);
    }
  }, [projectId]);

  useEffect(() => { setLoaded(false); void reload(); }, [reload]);

  // Light poll so the graph grows live while agents run / teaching merges. The read
  // endpoint is server-cached, so this is cheap.
  useEffect(() => {
    const id = setInterval(() => { void reload(); }, 20_000);
    return () => clearInterval(id);
  }, [reload]);

  const seeded = !!data?.seeded;
  const learning = seeded && data?.mode === 'connected';

  const regions = useMemo<RegionState[]>(() => {
    const recent = data?.recent ?? [];
    // "Fresh" = merged within the most recent slice, so the newest handful pulse.
    const times = recent.map((e) => e.at).sort((a, b) => b - a);
    const freshCutoffAt = times.length > 3 ? times[2] : (times[times.length - 1] ?? 0);

    const deltas = recent.filter((e) => e.kind === 'delta');
    const texts = recent.filter((e) => e.kind === 'text');
    const pending = data?.pending ?? 0;
    const teacher = data?.teacherModel ?? null;
    const version = data?.version ?? 0;

    const norm = (n: number, ceil: number) => Math.max(0, Math.min(1, n / ceil));

    const byKey: Record<RegionKey, RegionState> = {} as Record<RegionKey, RegionState>;
    for (const meta of REGIONS) {
      if (meta.key === 'cortex') {
        const nodes = layoutRegionNodes(meta, deltas, freshCutoffAt);
        byKey.cortex = {
          meta, nodes, count: deltas.length, overflow: Math.max(0, deltas.length - nodes.length),
          charge: seeded ? Math.max(0.28, norm(deltas.length, 12)) : 0.08,
          active: learning,
          caption: deltas.length > 0 ? t('cortexCaption', { count: deltas.length }) : t('regionIdle'),
        };
      } else if (meta.key === 'hippocampus') {
        const nodes = layoutRegionNodes(meta, texts, freshCutoffAt);
        byKey.hippocampus = {
          meta, nodes, count: texts.length, overflow: Math.max(0, texts.length - nodes.length),
          charge: seeded ? Math.max(0.28, norm(texts.length + pending, 12)) : 0.08,
          active: learning && (texts.length > 0 || pending > 0),
          caption: pending > 0 ? t('consolidating', { count: pending })
            : texts.length > 0 ? t('hippocampusCaption', { count: texts.length }) : t('regionIdle'),
        };
      } else if (meta.key === 'limbic') {
        byKey.limbic = {
          meta, nodes: [], count: 0, overflow: 0,
          charge: seeded ? (teacher ? 0.85 : 0.4) : 0.08,
          active: false,
          caption: !seeded ? t('regionDormant')
            : teacher ? t('limbicGuided', { model: teacher }) : t('limbicSelf'),
        };
      } else {
        byKey.personality = {
          meta, nodes: [], count: 0, overflow: 0,
          charge: seeded ? Math.max(0.5, norm(version, 8)) : 0.08,
          active: false,
          caption: !seeded ? t('regionDormant') : t('personalityCaption', { version }),
        };
      }
    }
    return REGIONS.map((r) => byKey[r.key]);
  }, [data, seeded, learning, t]);

  const status = !seeded ? t('statusDormant') : learning ? t('statusLearning') : t('statusFrozen');
  const statusTone: 'live' | 'frozen' | 'dormant' = !seeded ? 'dormant' : learning ? 'live' : 'frozen';

  return (
    <div className="ev-brainmap" style={rootStyle}>
      <style>{BRAINMAP_CSS}</style>

      <header style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', flexShrink: 0 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.05rem' }}>
          {t('title')}
        </h2>
        <span className={`ev-status ev-status-${statusTone}`}>
          <span className="ev-status-dot" aria-hidden />{status}
        </span>
        <p style={{ margin: 0, flexBasis: '100%', color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.5 }}>
          {t('subtitle')}
        </p>
      </header>

      {/* Stat strip — the model's headline learning figures. */}
      <div style={statStripStyle}>
        <Stat label={t('statVersion')} value={loaded ? `v${data?.version ?? 0}` : '…'} />
        <Stat label={t('statLearned')} value={loaded ? String(data?.contributions ?? 0) : '…'} />
        <Stat label={t('statQueued')} value={loaded ? String(data?.pending ?? 0) : '…'} />
      </div>

      <div style={{ position: 'relative', flex: '1 1 320px', minHeight: 260 }}>
        {!loaded ? (
          <Centered>{t('loading')}</Centered>
        ) : error ? (
          <Centered tone="error">
            {t('error')}{' '}
            <button type="button" onClick={() => void reload()} className="ev-retry">{t('retry')}</button>
          </Centered>
        ) : (
          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            role="img"
            aria-label={t('title')}
            preserveAspectRatio="xMidYMid meet"
            style={{ width: '100%', height: '100%', display: 'block' }}
          >
            {/* Edges: core → region. Animated dash flow when the region is learning. */}
            {regions.map((rs) => (
              <line
                key={`edge-${rs.meta.key}`}
                x1={CORE.x} y1={CORE.y} x2={rs.meta.x} y2={rs.meta.y}
                stroke={`var(${rs.meta.varName})`}
                strokeWidth={2 + rs.charge * 3}
                strokeLinecap="round"
                strokeOpacity={seeded ? 0.55 : 0.18}
                className={rs.active ? 'ev-edge ev-edge-live' : 'ev-edge'}
              />
            ))}

            {/* Knowledge nodes + their thin tethers to the region. */}
            {regions.flatMap((rs) =>
              rs.nodes.map((n) => (
                <g key={n.id} className={n.fresh ? 'ev-know ev-know-fresh' : 'ev-know'}>
                  <line
                    x1={rs.meta.x} y1={rs.meta.y} x2={n.x} y2={n.y}
                    stroke={`var(${rs.meta.varName})`} strokeWidth={1} strokeOpacity={0.3}
                  />
                  <circle
                    cx={n.x} cy={n.y} r={n.r}
                    fill={`var(${rs.meta.varName})`}
                    fillOpacity={n.entry.kind === 'delta' ? 0.9 : 0.42}
                    stroke={`var(${rs.meta.varName})`} strokeWidth={1.5}
                  >
                    <title>{nodeTitle(t, n.entry)}</title>
                  </circle>
                </g>
              )),
            )}

            {/* Region nodes. */}
            {regions.map((rs) => (
              <RegionGlyph key={rs.meta.key} rs={rs} label={t(rs.meta.key)} />
            ))}

            {/* Core. */}
            <g className="ev-core">
              <circle cx={CORE.x} cy={CORE.y} r={CORE_R + 8} fill="var(--ev-core)" fillOpacity={0.12} />
              <circle cx={CORE.x} cy={CORE.y} r={CORE_R} fill="var(--ev-core)" fillOpacity={seeded ? 0.9 : 0.3} />
              <text x={CORE.x} y={CORE.y - 2} textAnchor="middle" className="ev-core-emoji" fontSize={26}>🧠</text>
              <text x={CORE.x} y={CORE.y + 20} textAnchor="middle" className="ev-core-label">{t('coreLabel')}</text>
            </g>
          </svg>
        )}
      </div>

      {/* Legend — region identity is never colour-alone. */}
      <div style={legendStyle}>
        {regions.map((rs) => (
          <span key={rs.meta.key} className="ev-legend-item" title={t(`${rs.meta.key}Desc`)}>
            <span className="ev-legend-swatch" style={{ background: `var(${rs.meta.varName})` }} aria-hidden />
            <span className="ev-legend-name">{t(rs.meta.key)}</span>
            <span className="ev-legend-cap">{rs.caption}</span>
          </span>
        ))}
      </div>

      {!seeded && loaded && !error && (
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.78rem', fontStyle: 'italic' }}>
          {t('dormantHint')}
        </p>
      )}
    </div>
  );
}

/* ── SVG sub-parts ──────────────────────────────────────────────────────────── */

function RegionGlyph({ rs, label }: { rs: RegionState; label: string }) {
  const { meta, charge, count, overflow } = rs;
  const r = 26 + charge * 16;
  const hue = `var(${meta.varName})`;
  return (
    <g className={rs.active ? 'ev-region ev-region-active' : 'ev-region'}>
      <circle cx={meta.x} cy={meta.y} r={r + 6} fill={hue} fillOpacity={0.1} />
      <circle cx={meta.x} cy={meta.y} r={r} fill={hue} fillOpacity={0.16 + charge * 0.24} stroke={hue} strokeWidth={2.5} />
      <text x={meta.x} y={meta.y + 4} textAnchor="middle" className="ev-region-label">{label}</text>
      {(count > 0 || overflow > 0) && (
        <g>
          <circle cx={meta.x + r - 2} cy={meta.y - r + 2} r={12} fill={hue} />
          <text x={meta.x + r - 2} y={meta.y - r + 6} textAnchor="middle" className="ev-region-badge">
            {overflow > 0 ? `${count}` : count}
          </text>
        </g>
      )}
      <title>{`${label} — ${rs.caption}`}</title>
    </g>
  );
}

function nodeTitle(
  t: ReturnType<typeof useTranslations>,
  e: ProjectEvermindRecentEntry,
): string {
  const kind = e.kind === 'delta' ? t('nodeDelta') : t('nodeText');
  const head = e.prompt || e.text || kind;
  return `${kind} · v${e.version}\n${head}`.slice(0, 220);
}

/* ── HTML atoms ─────────────────────────────────────────────────────────────── */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={statStyle}>
      <div style={{ fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function Centered({ children, tone }: { children: React.ReactNode; tone?: 'error' }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      textAlign: 'center', padding: 24, color: tone === 'error' ? '#f87171' : 'var(--text-muted)', fontSize: '0.85rem',
    }}>
      <span>{children}</span>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────────────── */

const rootStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 12, height: '100%', minHeight: 0,
  background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
  borderRadius: 14, padding: '16px 18px', color: 'var(--text-primary)',
};

const statStripStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, flexShrink: 0,
};

const statStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
  borderRadius: 10, padding: '8px 12px',
};

const legendStyle: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: '8px 14px', flexShrink: 0,
  borderTop: '1px solid var(--border-subtle)', paddingTop: 10,
};

/* Region hues follow the app theme. Dark is the default (the app boots dark); the
   `[data-theme='light']` override supplies the light-surface steps. Every region
   also carries a text label, so the sub-3:1 light aqua/magenta are relieved. */
const BRAINMAP_CSS = `
.ev-brainmap {
  --ev-cortex: #3987e5;
  --ev-hippocampus: #199e70;
  --ev-limbic: #d55181;
  --ev-personality: #9085e9;
  --ev-core: var(--coral-bright, #ff6b5e);
}
:root[data-theme='light'] .ev-brainmap {
  --ev-cortex: #2a78d6;
  --ev-hippocampus: #1baf7a;
  --ev-limbic: #e87ba4;
  --ev-personality: #4a3aa7;
}
.ev-brainmap .ev-region-label {
  fill: var(--text-primary); font-size: 13px; font-weight: 700;
  font-family: var(--font-display, system-ui); paint-order: stroke;
}
.ev-brainmap .ev-region-badge { fill: #fff; font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }
.ev-brainmap .ev-core-label { fill: #fff; font-size: 12px; font-weight: 700; font-family: var(--font-display, system-ui); }
.ev-brainmap .ev-core-emoji { dominant-baseline: middle; }
.ev-status {
  display: inline-flex; align-items: center; gap: 6px; font-size: 0.72rem; font-weight: 700;
  padding: 3px 10px; border-radius: 999px; border: 1px solid var(--border-subtle); background: var(--bg-elevated);
}
.ev-status-dot { width: 7px; height: 7px; border-radius: 999px; background: currentColor; }
.ev-status-live { color: #22c55e; }
.ev-status-frozen { color: var(--text-muted); }
.ev-status-dormant { color: var(--text-muted); }
.ev-legend-item { display: inline-flex; align-items: center; gap: 6px; font-size: 0.74rem; max-width: 100%; }
.ev-legend-swatch { width: 11px; height: 11px; border-radius: 3px; flex-shrink: 0; }
.ev-legend-name { font-weight: 700; color: var(--text-primary); }
.ev-legend-cap { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
.ev-retry {
  background: transparent; color: inherit; border: 1px solid currentColor; border-radius: 6px;
  padding: 1px 9px; font-size: 0.74rem; cursor: pointer; margin-left: 4px;
}
@media (prefers-reduced-motion: no-preference) {
  .ev-brainmap .ev-edge-live {
    stroke-dasharray: 6 10;
    animation: ev-flow 1.1s linear infinite;
  }
  @keyframes ev-flow { to { stroke-dashoffset: -32; } }
  .ev-brainmap .ev-core circle:nth-child(1) { animation: ev-breathe 3.4s ease-in-out infinite; transform-origin: center; transform-box: fill-box; }
  @keyframes ev-breathe { 0%,100% { opacity: 0.12; } 50% { opacity: 0.26; } }
  .ev-brainmap .ev-know-fresh circle { animation: ev-pop 1.6s ease-out infinite; transform-origin: center; transform-box: fill-box; }
  @keyframes ev-pop { 0% { transform: scale(0.4); } 40% { transform: scale(1.25); } 100% { transform: scale(1); } }
  .ev-brainmap .ev-region-active > circle:nth-child(1) { animation: ev-halo 2.6s ease-in-out infinite; transform-origin: center; transform-box: fill-box; }
  @keyframes ev-halo { 0%,100% { opacity: 0.1; } 50% { opacity: 0.28; } }
}
`;
