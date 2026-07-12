'use client';

/**
 * EvermindBrainMap — the center-stage visualization for the `llm` build modality.
 *
 * It renders the project's Evermind as the brain the SSM + memory runtime actually
 * models, and grows a live graph of the knowledge each region learns as agents run
 * and teaching lands. The regions mirror the runtime's own anatomy
 * (builderforce-memory `limbic/regions.ts` + the HybridMamba memory core):
 *
 *   Memory & reasoning (what the agent knows)
 *     • Neocortex    — SSM reasoning weights, sharpened by each run's weight delta
 *     • Hippocampus  — episodic memory; taught transcripts / run text consolidate here
 *   Limbic system (how it feels & acts — affective dynamics)
 *     • Amygdala      — salience / threat appraisal (valence + arousal)
 *     • Hypothalamus  — homeostatic drives (curiosity, caution, effort, social)
 *     • Thalamus      — attention gate
 *     • Basal ganglia — action selection (explore vs. exploit)
 *   Personality — the static trait setpoints the limbic dynamics relax toward
 *
 * Every accreting node is real: the graph is derived from the SAME server-cached
 * `/evermind/contributions` payload the training console reads. `delta` contributions
 * flow into the Neocortex; `text` contributions consolidate in the Hippocampus. The
 * limbic regions and Personality carry their real functional role and a charge driven
 * by the model's live configuration (seeded / mode / teacher / version) — no fabricated
 * affect numbers. The component self-gates (loading / dormant / error), polls lightly
 * so the graph stays live, and themes through cascading CSS variables so it reads
 * natively in light and dark. Region hues are the validated categorical slots and every
 * region carries an always-visible label, so identity is never colour-alone.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  getProjectEvermindContributions,
  type ProjectEvermindContributions,
  type ProjectEvermindRecentEntry,
} from '@/lib/projectEvermindApi';
import { CompactListProgress, type ProgressItem } from '@/components/lists';

/* ── Geometry (SVG user units; the viewBox scales to the container) ──────────── */
const VB_W = 860;
const VB_H = 600;
const CORE = { x: 430, y: 300 };
const CORE_R = 40;

type RegionKey =
  | 'neocortex' | 'hippocampus'
  | 'amygdala' | 'hypothalamus' | 'thalamus' | 'basalGanglia'
  | 'personality';
type RegionGroup = 'memory' | 'limbic' | 'trait';

interface RegionMeta {
  key: RegionKey;
  group: RegionGroup;
  x: number;
  y: number;
  /** CSS variable carrying the region's themed hue. */
  varName: string;
  /** Base node radius before charge scaling. */
  size: number;
  /** If set, this region accretes a live knowledge-node cluster of that kind. */
  accretes?: ProjectEvermindRecentEntry['kind'];
}

const REGIONS: RegionMeta[] = [
  // Memory & reasoning core — the two accreting knowledge regions.
  { key: 'neocortex', group: 'memory', x: 430, y: 120, varName: '--ev-neocortex', size: 40, accretes: 'delta' },
  { key: 'hippocampus', group: 'memory', x: 720, y: 235, varName: '--ev-hippocampus', size: 38, accretes: 'text' },
  // Limbic system — affective dynamics.
  { key: 'amygdala', group: 'limbic', x: 250, y: 490, varName: '--ev-amygdala', size: 24 },
  { key: 'hypothalamus', group: 'limbic', x: 430, y: 522, varName: '--ev-hypothalamus', size: 24 },
  { key: 'thalamus', group: 'limbic', x: 610, y: 495, varName: '--ev-thalamus', size: 24 },
  { key: 'basalGanglia', group: 'limbic', x: 735, y: 400, varName: '--ev-basal', size: 24 },
  // Personality — the trait setpoints that condition the limbic regions.
  { key: 'personality', group: 'trait', x: 140, y: 265, varName: '--ev-personality', size: 30 },
];

const LIMBIC_KEYS: RegionKey[] = ['amygdala', 'hypothalamus', 'thalamus', 'basalGanglia'];

/** Max knowledge nodes drawn per region before we summarise the remainder. */
const MAX_NODES_PER_REGION = 14;
const GOLDEN = 2.399963; // radians — even, stable fan-out with no RNG

/** A learned contribution positioned around its region. */
interface KnowledgeNode {
  id: string;
  x: number;
  y: number;
  r: number;
  fresh: boolean;
  entry: ProjectEvermindRecentEntry;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Deterministically fan `entries` out around a region centre (stable across polls). */
function layoutRegionNodes(
  region: RegionMeta,
  entries: ProjectEvermindRecentEntry[],
  freshCutoffAt: number,
): KnowledgeNode[] {
  const shown = entries.slice(0, MAX_NODES_PER_REGION);
  // Fan the cluster into the open space away from the core, so it reads as "wired in".
  const awayFromCore = Math.atan2(region.y - CORE.y, region.x - CORE.x);
  return shown.map((entry, i) => {
    const angle = awayFromCore + (i % 2 === 0 ? 1 : -1) * ((i + 1) * (GOLDEN / 3)) % 1.4;
    const ring = region.size + 20 + (i % 3) * 18;
    return {
      id: `${region.key}-${entry.version}-${entry.at}-${i}`,
      x: clamp(region.x + Math.cos(angle) * ring, 18, VB_W - 18),
      y: clamp(region.y + Math.sin(angle) * ring, 18, VB_H - 18),
      r: 6 + Math.min(4, Math.max(0, entry.weight - 1)),
      fresh: entry.at >= freshCutoffAt,
      entry,
    };
  });
}

interface RegionState {
  meta: RegionMeta;
  /** 0..1 charge driving ring fill + radius. */
  charge: number;
  count: number;
  nodes: KnowledgeNode[];
  overflow: number;
  /** Whether the core→region edge should animate (this region is actively learning). */
  active: boolean;
  /** Short state caption for the legend. */
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
    const times = recent.map((e) => e.at).sort((a, b) => b - a);
    const freshCutoffAt = times.length > 3 ? times[2] : (times[times.length - 1] ?? 0);

    const deltas = recent.filter((e) => e.kind === 'delta');
    const texts = recent.filter((e) => e.kind === 'text');
    const pending = data?.pending ?? 0;
    const teacher = data?.teacherModel ?? null;
    const version = data?.version ?? 0;
    const dim = seeded ? 1 : 0.08;
    const norm = (n: number, ceil: number) => clamp(n / ceil, 0, 1);

    return REGIONS.map((meta): RegionState => {
      switch (meta.key) {
        case 'neocortex': {
          const nodes = layoutRegionNodes(meta, deltas, freshCutoffAt);
          return {
            meta, nodes, count: deltas.length, overflow: Math.max(0, deltas.length - nodes.length),
            charge: seeded ? Math.max(0.3, norm(deltas.length, 12)) : dim,
            active: learning,
            caption: deltas.length > 0 ? t('neocortexCaption', { count: deltas.length }) : t('neocortexRole'),
          };
        }
        case 'hippocampus': {
          const nodes = layoutRegionNodes(meta, texts, freshCutoffAt);
          return {
            meta, nodes, count: texts.length, overflow: Math.max(0, texts.length - nodes.length),
            charge: seeded ? Math.max(0.3, norm(texts.length + pending, 12)) : dim,
            active: learning && (texts.length > 0 || pending > 0),
            caption: pending > 0 ? t('consolidating', { count: pending })
              : texts.length > 0 ? t('hippocampusCaption', { count: texts.length }) : t('hippocampusRole'),
          };
        }
        case 'personality':
          return {
            meta, nodes: [], count: 0, overflow: 0,
            charge: seeded ? Math.max(0.5, norm(version, 8)) : dim,
            active: false,
            caption: seeded ? t('personalityCaption', { version }) : t('regionDormant'),
          };
        // Limbic regions: real functional role; charge reflects that the affective
        // layer is live once seeded (its per-run state is a runtime concern, not part
        // of the learning payload — so no fabricated valence/arousal numbers here).
        case 'amygdala':
          return { meta, nodes: [], count: 0, overflow: 0, charge: teacher ? 0.7 : (seeded ? 0.5 : dim), active: learning, caption: t('amygdalaRole') };
        case 'hypothalamus':
          return { meta, nodes: [], count: 0, overflow: 0, charge: seeded ? 0.5 : dim, active: learning, caption: t('hypothalamusRole') };
        case 'thalamus':
          return { meta, nodes: [], count: 0, overflow: 0, charge: seeded ? 0.5 : dim, active: learning, caption: t('thalamusRole') };
        case 'basalGanglia':
        default:
          return { meta, nodes: [], count: 0, overflow: 0, charge: seeded ? 0.5 : dim, active: learning, caption: t('basalGangliaRole') };
      }
    });
  }, [data, seeded, learning, t]);

  const byKey = useMemo(() => {
    const m = {} as Record<RegionKey, RegionState>;
    for (const rs of regions) m[rs.meta.key] = rs;
    return m;
  }, [regions]);

  const status = !seeded ? t('statusDormant') : learning ? t('statusLearning') : t('statusFrozen');
  const statusTone: 'live' | 'frozen' | 'dormant' = !seeded ? 'dormant' : learning ? 'live' : 'frozen';
  const personality = byKey.personality;

  return (
    <div className="ev-brainmap" style={rootStyle}>
      <style>{BRAINMAP_CSS}</style>

      <header style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', flexShrink: 0 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.05rem' }}>{t('title')}</h2>
        <span className={`ev-status ev-status-${statusTone}`}><span className="ev-status-dot" aria-hidden />{status}</span>
        <p style={{ margin: 0, flexBasis: '100%', color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.5 }}>{t('subtitle')}</p>
      </header>

      <div style={statStripStyle}>
        <Stat label={t('statVersion')} value={loaded ? `v${data?.version ?? 0}` : '…'} />
        <Stat label={t('statLearned')} value={loaded ? String(data?.contributions ?? 0) : '…'} />
        <Stat label={t('statQueued')} value={loaded ? String(data?.pending ?? 0) : '…'} />
      </div>

      <div style={{ position: 'relative', flex: '1 1 300px', minHeight: 300 }}>
        {!loaded ? (
          <Centered>{t('loading')}</Centered>
        ) : error ? (
          <Centered tone="error">
            {t('error')} <button type="button" onClick={() => void reload()} className="ev-retry">{t('retry')}</button>
          </Centered>
        ) : (
          <svg viewBox={`0 0 ${VB_W} ${VB_H}`} role="img" aria-label={t('title')} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block' }}>
            {/* Personality → limbic "setpoint" edges (personality conditions the limbic dynamics). */}
            {personality && LIMBIC_KEYS.map((k) => {
              const r = byKey[k];
              return (
                <line key={`set-${k}`} x1={personality.meta.x} y1={personality.meta.y} x2={r.meta.x} y2={r.meta.y}
                  stroke="var(--ev-personality)" strokeWidth={1.5} strokeOpacity={seeded ? 0.32 : 0.12}
                  strokeDasharray="2 7" strokeLinecap="round" />
              );
            })}

            {/* Core → region edges; animated dash flow when the region is learning. */}
            {regions.map((rs) => (
              <line key={`edge-${rs.meta.key}`} x1={CORE.x} y1={CORE.y} x2={rs.meta.x} y2={rs.meta.y}
                stroke={`var(${rs.meta.varName})`} strokeWidth={rs.meta.group === 'memory' ? 2 + rs.charge * 3 : 1.75}
                strokeLinecap="round" strokeOpacity={seeded ? (rs.meta.group === 'memory' ? 0.55 : 0.4) : 0.16}
                className={rs.active ? 'ev-edge ev-edge-live' : 'ev-edge'} />
            ))}

            {/* Knowledge nodes + their tethers. */}
            {regions.flatMap((rs) => rs.nodes.map((n) => (
              <g key={n.id} className={n.fresh ? 'ev-know ev-know-fresh' : 'ev-know'}>
                <line x1={rs.meta.x} y1={rs.meta.y} x2={n.x} y2={n.y} stroke={`var(${rs.meta.varName})`} strokeWidth={1} strokeOpacity={0.3} />
                <circle cx={n.x} cy={n.y} r={n.r} fill={`var(${rs.meta.varName})`} fillOpacity={n.entry.kind === 'delta' ? 0.9 : 0.45} stroke={`var(${rs.meta.varName})`} strokeWidth={1.5}>
                  <title>{nodeTitle(t, n.entry)}</title>
                </circle>
              </g>
            )))}

            {/* Region nodes. */}
            {regions.map((rs) => <RegionGlyph key={rs.meta.key} rs={rs} label={t(rs.meta.key)} />)}

            {/* Core. */}
            <g className="ev-core">
              <circle cx={CORE.x} cy={CORE.y} r={CORE_R + 8} fill="var(--ev-core)" fillOpacity={0.12} />
              <circle cx={CORE.x} cy={CORE.y} r={CORE_R} fill="var(--ev-core)" fillOpacity={seeded ? 0.9 : 0.3} />
              <text x={CORE.x} y={CORE.y - 2} textAnchor="middle" className="ev-core-emoji" fontSize={24}>🧠</text>
              <text x={CORE.x} y={CORE.y + 19} textAnchor="middle" className="ev-core-label">{t('coreLabel')}</text>
            </g>
          </svg>
        )}
      </div>

      {/* Tiered legend — teaches the architecture; identity is never colour-alone. */}
      <div style={legendStyle}>
        <LegendTier heading={t('tierMemory')} regions={regions.filter((r) => r.meta.group === 'memory')} labelOf={(k) => t(k)} descOf={(k) => t(`${k}Desc`)} />
        <LegendTier heading={t('tierLimbic')} regions={regions.filter((r) => r.meta.group === 'limbic')} labelOf={(k) => t(k)} descOf={(k) => t(`${k}Desc`)} />
        <LegendTier heading={t('tierPersonality')} regions={regions.filter((r) => r.meta.group === 'trait')} labelOf={(k) => t(k)} descOf={(k) => t(`${k}Desc`)} />
      </div>

      {!seeded && loaded && !error && (
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.78rem', fontStyle: 'italic' }}>{t('dormantHint')}</p>
      )}
    </div>
  );
}

/* ── SVG / HTML sub-parts ───────────────────────────────────────────────────── */

function RegionGlyph({ rs, label }: { rs: RegionState; label: string }) {
  const { meta, charge, count, overflow } = rs;
  const r = meta.size * 0.7 + charge * meta.size * 0.5;
  const hue = `var(${meta.varName})`;
  const showBadge = !!meta.accretes && (count > 0 || overflow > 0);
  return (
    <g className={rs.active ? 'ev-region ev-region-active' : 'ev-region'}>
      <circle cx={meta.x} cy={meta.y} r={r + 6} fill={hue} fillOpacity={0.1} />
      <circle cx={meta.x} cy={meta.y} r={r} fill={hue} fillOpacity={0.16 + charge * 0.24} stroke={hue} strokeWidth={2.5} />
      <text x={meta.x} y={meta.y + 4} textAnchor="middle" className={`ev-region-label ${meta.group === 'limbic' ? 'ev-region-label-sm' : ''}`}>{label}</text>
      {showBadge && (
        <g>
          <circle cx={meta.x + r - 2} cy={meta.y - r + 2} r={12} fill={hue} />
          <text x={meta.x + r - 2} y={meta.y - r + 6} textAnchor="middle" className="ev-region-badge">{count}</text>
        </g>
      )}
      <title>{`${label} — ${rs.caption}`}</title>
    </g>
  );
}

function LegendTier({
  heading, regions, labelOf, descOf,
}: {
  heading: string; regions: RegionState[]; labelOf: (k: RegionKey) => string; descOf: (k: RegionKey) => string;
}) {
  return (
    <div className="ev-legend-tier">
      <div className="ev-legend-heading">{heading}</div>
      <div className="ev-legend-rows">
        {regions.map((rs) => (
          <span key={rs.meta.key} className="ev-legend-item" title={descOf(rs.meta.key)}>
            <span className="ev-legend-swatch" style={{ background: `var(${rs.meta.varName})` }} aria-hidden />
            <span className="ev-legend-name">{labelOf(rs.meta.key)}</span>
            <span className="ev-legend-cap">{rs.caption}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function nodeTitle(t: ReturnType<typeof useTranslations>, e: ProjectEvermindRecentEntry): string {
  const kind = e.kind === 'delta' ? t('nodeDelta') : t('nodeText');
  const head = e.prompt || e.text || kind;
  return `${kind} · v${e.version}\n${head}`.slice(0, 220);
}

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
const statStripStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, flexShrink: 0 };
const statStyle: React.CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '8px 12px' };
const legendStyle: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: '10px 20px', flexShrink: 0,
  borderTop: '1px solid var(--border-subtle)', paddingTop: 10,
};

/* Region hues follow the app theme (dark is the app default; the light override
   supplies the light-surface steps). All are validated categorical slots. Every
   region carries a text label, so the sub-3:1 light steps are relieved. */
const BRAINMAP_CSS = `
.ev-brainmap {
  --ev-neocortex: #3987e5;
  --ev-hippocampus: #199e70;
  --ev-amygdala: #e66767;
  --ev-hypothalamus: #d95926;
  --ev-thalamus: #c98500;
  --ev-basal: #d55181;
  --ev-personality: #9085e9;
  --ev-core: var(--coral-bright, #ff6b5e);
}
:root[data-theme='light'] .ev-brainmap {
  --ev-neocortex: #2a78d6;
  --ev-hippocampus: #1baf7a;
  --ev-amygdala: #e34948;
  --ev-hypothalamus: #eb6834;
  --ev-thalamus: #eda100;
  --ev-basal: #e87ba4;
  --ev-personality: #4a3aa7;
}
.ev-brainmap .ev-region-label { fill: var(--text-primary); font-size: 13px; font-weight: 700; font-family: var(--font-display, system-ui); }
.ev-brainmap .ev-region-label-sm { font-size: 11px; }
.ev-brainmap .ev-region-badge { fill: #fff; font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }
.ev-brainmap .ev-core-label { fill: #fff; font-size: 11px; font-weight: 700; font-family: var(--font-display, system-ui); }
.ev-brainmap .ev-core-emoji { dominant-baseline: middle; }
.ev-status { display: inline-flex; align-items: center; gap: 6px; font-size: 0.72rem; font-weight: 700; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--border-subtle); background: var(--bg-elevated); }
.ev-status-dot { width: 7px; height: 7px; border-radius: 999px; background: currentColor; }
.ev-status-live { color: #22c55e; }
.ev-status-frozen, .ev-status-dormant { color: var(--text-muted); }
.ev-legend-tier { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ev-legend-heading { font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
.ev-legend-rows { display: flex; flex-direction: column; gap: 3px; }
.ev-legend-item { display: inline-flex; align-items: center; gap: 6px; font-size: 0.74rem; max-width: 320px; }
.ev-legend-swatch { width: 11px; height: 11px; border-radius: 3px; flex-shrink: 0; }
.ev-legend-name { font-weight: 700; color: var(--text-primary); white-space: nowrap; }
.ev-legend-cap { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ev-retry { background: transparent; color: inherit; border: 1px solid currentColor; border-radius: 6px; padding: 1px 9px; font-size: 0.74rem; cursor: pointer; margin-left: 4px; }
@media (prefers-reduced-motion: no-preference) {
  .ev-brainmap .ev-edge-live { stroke-dasharray: 6 10; animation: ev-flow 1.1s linear infinite; }
  @keyframes ev-flow { to { stroke-dashoffset: -32; } }
  .ev-brainmap .ev-core circle:nth-child(1) { animation: ev-breathe 3.4s ease-in-out infinite; transform-origin: center; transform-box: fill-box; }
  @keyframes ev-breathe { 0%,100% { opacity: 0.12; } 50% { opacity: 0.26; } }
  .ev-brainmap .ev-know-fresh circle { animation: ev-pop 1.6s ease-out infinite; transform-origin: center; transform-box: fill-box; }
  @keyframes ev-pop { 0% { transform: scale(0.4); } 40% { transform: scale(1.25); } 100% { transform: scale(1); } }
  .ev-brainmap .ev-region-active > circle:nth-child(1) { animation: ev-halo 2.6s ease-in-out infinite; transform-origin: center; transform-box: fill-box; }
  @keyframes ev-halo { 0%,100% { opacity: 0.1; } 50% { opacity: 0.28; } }
}
`;
