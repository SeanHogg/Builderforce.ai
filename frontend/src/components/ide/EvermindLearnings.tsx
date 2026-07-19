'use client';

/**
 * EvermindLearnings — the center-stage "Learnings" list beside the Knowledge Map.
 * Three modes, in priority order:
 *
 *  1. Recall (Validate) — when a Validate has run, the list becomes the recall
 *     result: the learned memories that would answer the task, ranked by score,
 *     the top one badged "most likely used". This is what the map highlights too.
 *  2. Region filter — clicking a brain region narrows the list to that region's
 *     knowledge (Neocortex → `delta` runs, Hippocampus → `text` contributions), or,
 *     for a limbic / Personality region, shows that region's LIVE affective state as
 *     meters (it carries state, not discrete memories) plus a jump to tune it.
 *  3. All — everything learned, newest first.
 *
 * Every listed memory has a "View detail" that opens the full task + learned text in
 * a SlideOutPanel (the app's canonical detail overlay). Reads the SAME contributions
 * payload the map does (passed in) plus the shared Validate highlight from context.
 * Themed + localized; the `--ev-*` region hues cascade from the `.ev-studio` ancestor.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import type {
  ProjectEvermindAffect,
  ProjectEvermindContributions,
  ProjectEvermindRecentEntry,
} from '@/lib/projectEvermindApi';
import {
  REGION_HUE_VAR, recentForRegion, regionAccretes,
  type EvermindRegionKey,
} from '@/lib/evermindRegions';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { evermindLearnedStatus, type EvermindTeacherSkipReason } from '@seanhogg/builderforce-brain-ui';
import { useEvermindValidation } from './EvermindValidationContext';

/** A listed memory optionally carrying its Validate recall score (recall mode). */
type ListedEntry = ProjectEvermindRecentEntry & { score?: number };

/** Which live affective dimensions a state-region surfaces, as 0..1 meters. */
function regionMeters(key: EvermindRegionKey, affect: ProjectEvermindAffect): Array<{ key: string; label: string; value: number; raw: number }> {
  const s = affect.state;
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  const mk = (k: string, label: string, width: number, raw: number) => ({ key: k, label, value: clamp01(width), raw });
  switch (key) {
    case 'amygdala':
      // valence is signed (-1..1) → centre it for the bar; arousal is already 0..1.
      return [mk('valence', 'meterValence', (s.valence + 1) / 2, s.valence), mk('arousal', 'meterArousal', s.arousal, s.arousal)];
    case 'hypothalamus':
      return [
        mk('curiosity', 'meterCuriosity', s.driveCuriosity, s.driveCuriosity),
        mk('caution', 'meterCaution', s.driveCaution, s.driveCaution),
        mk('effort', 'meterEffort', s.driveEffort, s.driveEffort),
        mk('social', 'meterSocial', s.driveSocial, s.driveSocial),
      ];
    case 'thalamus':
      return [mk('attention', 'meterAttention', affect.attentionGain, affect.attentionGain)];
    case 'basalGanglia':
      return [mk('explore', 'meterExplore', affect.exploreBias, affect.exploreBias)];
    default:
      return [];
  }
}

export function EvermindLearnings({
  data, selectedRegion, onClearRegion,
}: {
  data: ProjectEvermindContributions | null;
  selectedRegion: EvermindRegionKey | null;
  onClearRegion: () => void;
}) {
  const t = useTranslations('evermindBrain');
  const format = useFormatter();
  const { highlight, primaryId, setHighlight } = useEvermindValidation();
  const [detail, setDetail] = useState<ListedEntry | null>(null);

  const recent = data?.recent ?? [];
  const accretes = selectedRegion ? regionAccretes(selectedRegion) : null;
  // Recall mode (a Validate ran) overrides the region filter entirely.
  const recallMode = highlight != null;

  // What to list: recall → the ranked matches; a memory region → its kind; no
  // selection → everything; a limbic / personality region → nothing (live state).
  const entries = useMemo<ListedEntry[]>(() => {
    if (recallMode) return highlight!.matches;
    if (!selectedRegion) return recent;
    return accretes ? recentForRegion(recent, selectedRegion) : [];
  }, [recallMode, highlight, recent, selectedRegion, accretes]);

  const regionLabel = selectedRegion ? t(selectedRegion) : null;
  const isStateRegion = !recallMode && selectedRegion != null && !accretes; // limbic / personality
  const meters = isStateRegion && data?.affect ? regionMeters(selectedRegion!, data.affect) : [];

  return (
    <section style={rootStyle} aria-label={t('learningsTitle')}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
        <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.95rem' }}>
          {recallMode ? t('recallTitle') : t('learningsTitle')}
        </h3>
        {recallMode ? (
          <>
            <button type="button" onClick={() => setHighlight(null)} style={filterChip}>
              <span aria-hidden style={{ opacity: 0.8 }}>🎯</span>
              {t('recallFor', { prompt: highlight!.prompt })}
              <span aria-hidden style={{ marginLeft: 2, opacity: 0.7 }}>✕</span>
            </button>
            <span style={methodChip}>{t('recallMethod', { method: highlight!.method })}</span>
          </>
        ) : selectedRegion ? (
          <button type="button" onClick={onClearRegion} style={filterChip}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: `var(${REGION_HUE_VAR[selectedRegion]})` }} aria-hidden />
            {regionLabel}
            <span aria-hidden style={{ marginLeft: 2, opacity: 0.7 }}>✕</span>
          </button>
        ) : (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{t('learningsAll')}</span>
        )}
      </header>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {isStateRegion ? (
          <StateRegionView t={t} regionLabel={regionLabel ?? ''} regionKey={selectedRegion!} meters={meters} />
        ) : entries.length === 0 ? (
          <p style={noteStyle}>
            {recallMode ? t('recallEmpty')
              : selectedRegion ? t('learningsEmptyRegion', { region: regionLabel ?? '' })
              : t('learningsEmptyAll')}
          </p>
        ) : (
          entries.map((e) => (
            <LearningRow
              key={e.id} entry={e} when={format.relativeTime(new Date(e.at))}
              kindLabel={e.kind === 'delta' ? t('nodeDelta') : t('nodeText')} deltaBody={t('deltaBody')}
              primary={recallMode && e.id === primaryId}
              scoreLabel={e.score != null ? t('recallScore', { pct: Math.round(e.score * 100) }) : null}
              primaryBadge={t('recallPrimary')}
              onViewDetail={() => setDetail(e)} viewDetailLabel={t('viewDetail')}
              faultBadge={t('faultBadge')}
            />
          ))
        )}
      </div>

      <DetailPanel entry={detail} onClose={() => setDetail(null)} t={t} formatWhen={(at) => format.relativeTime(new Date(at))} />
    </section>
  );
}

/** A limbic / Personality region's LIVE state as meters, plus a jump to tune it. */
function StateRegionView({
  t, regionLabel, regionKey, meters,
}: {
  t: ReturnType<typeof useTranslations>; regionLabel: string; regionKey: EvermindRegionKey;
  meters: Array<{ key: string; label: string; value: number; raw: number }>;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={noteStyle}>{t('learningsRegionNote', { region: regionLabel })}</p>
      {meters.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {meters.map((m) => (
            <div key={m.key}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                <span>{t(m.label)}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>{m.raw.toFixed(2)}</span>
              </div>
              <div style={{ height: 6, borderRadius: 999, background: 'var(--border-subtle)', overflow: 'hidden', marginTop: 3 }}>
                <div style={{ width: `${Math.round(m.value * 100)}%`, height: '100%', background: `var(${REGION_HUE_VAR[regionKey]})` }} />
              </div>
            </div>
          ))}
        </div>
      )}
      {/* Personality is the only state region you steer directly — its setpoints are the
          psychometric persona. Jump there rather than dead-end on a note (gap fix). */}
      {regionKey === 'personality' && (
        <Link href="/settings/persona" style={tuneLinkStyle}>
          {t('tunePersonality')} →
        </Link>
      )}
    </div>
  );
}

function LearningRow({
  entry, when, kindLabel, deltaBody, primary, scoreLabel, primaryBadge, onViewDetail, viewDetailLabel, faultBadge,
}: {
  entry: ListedEntry; when: string; kindLabel: string; deltaBody: string;
  primary: boolean; scoreLabel: string | null; primaryBadge: string;
  onViewDetail: () => void; viewDetailLabel: string; faultBadge: string;
}) {
  // A failed teach-a-task has no trustworthy answer to preview — show the fault badge
  // rather than the un-distilled text (which is just the question again).
  const faulted = evermindLearnedStatus(entry).state === 'fault';
  const body = entry.kind === 'delta' ? deltaBody : (faulted ? '' : (entry.text ?? ''));
  const hasDetail = entry.kind !== 'delta' && (!!entry.prompt || !!entry.text || faulted);
  const pct = entry.score != null ? Math.round(entry.score * 100) : null;
  return (
    <div style={{ ...rowStyle, ...(primary ? { borderColor: 'var(--coral-bright, #ff6b5e)' } : null) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {primary && <span style={primaryBadgeStyle}>{primaryBadge}</span>}
        <span style={tagStyle(entry.kind === 'delta')}>{kindLabel}</span>
        {faulted && <span style={faultBadgeStyle}>{faultBadge}</span>}
        <span style={metaText}>v{entry.version}</span>
        <span style={metaText}>×{entry.weight}</span>
        {scoreLabel ? (
          <span style={{ ...metaText, marginLeft: 'auto', fontWeight: 700, color: 'var(--coral-bright, #ff6b5e)' }}>{scoreLabel}</span>
        ) : (
          <span style={{ ...metaText, marginLeft: 'auto' }}>{when}</span>
        )}
      </div>
      {pct != null && (
        <div style={{ height: 4, borderRadius: 999, background: 'var(--border-subtle)', overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--coral-bright, #ff6b5e)' }} />
        </div>
      )}
      {entry.prompt && <div style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-word' }}>{entry.prompt}</div>}
      {body && <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.45, wordBreak: 'break-word', whiteSpace: 'pre-wrap', maxHeight: 72, overflow: 'hidden' }}>{body}</div>}
      {hasDetail && (
        <button type="button" onClick={onViewDetail} style={detailLinkStyle}>{viewDetailLabel}</button>
      )}
    </div>
  );
}

/** The full-detail overlay for one learned memory (canonical SlideOutPanel). */
function DetailPanel({
  entry, onClose, t, formatWhen,
}: {
  entry: ListedEntry | null; onClose: () => void;
  t: ReturnType<typeof useTranslations>; formatWhen: (atMs: number) => string;
}) {
  return (
    <SlideOutPanel open={entry != null} onClose={onClose} title={t('detailTitle')}>
      {entry && (
        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <DetailChip label={t('detailKind')} value={entry.kind === 'delta' ? t('nodeDelta') : t('nodeText')} />
            <DetailChip label={t('detailVersion')} value={`v${entry.version}`} />
            <DetailChip label={t('detailWeight')} value={`×${entry.weight}`} />
            <DetailChip label={t('detailWhen')} value={formatWhen(entry.at)} />
            {entry.score != null && <DetailChip label={t('recallScore', { pct: Math.round(entry.score * 100) })} value="" />}
            <TeacherChip entry={entry} t={t} />
          </div>
          {entry.prompt && (
            <div>
              <div style={detailSectionLabel}>{t('detailTask')}</div>
              <div style={detailBody}>{entry.prompt}</div>
            </div>
          )}
          <LearnedSection entry={entry} t={t} />
          <TeacherFaultNotice entry={entry} t={t} />
        </div>
      )}
    </SlideOutPanel>
  );
}

/** The provenance chip: which frontier teacher distilled this memory, or that the model
 *  self-learned it. Absent for weight deltas (no text provenance) and for faults, which
 *  get the louder {@link TeacherFaultNotice} instead. */
function TeacherChip({ entry, t }: { entry: ListedEntry; t: ReturnType<typeof useTranslations> }) {
  const status = evermindLearnedStatus(entry);
  if (status.state === 'distilled') {
    return <DetailChip label={t('detailTeacher')} value={status.teacherModel ?? t('detailTeacherUnknown')} />;
  }
  if (status.state === 'self') return <DetailChip label={t('detailTeacher')} value={t('detailTeacherSelf')} />;
  return null;
}

/** The "Learned" body — or, when a pinned teacher produced no answer, an explicit
 *  "nothing was learned" state. Rendering the raw text here would mean showing the
 *  user's own question back as the model's answer, which is what made a broken teacher
 *  look like a working one. */
function LearnedSection({ entry, t }: { entry: ListedEntry; t: ReturnType<typeof useTranslations> }) {
  const status = evermindLearnedStatus(entry);
  const body = entry.kind === 'delta' ? t('deltaBody') : (entry.text ?? '');
  return (
    <div>
      <div style={detailSectionLabel}>{t('detailLearned')}</div>
      {status.state === 'fault' || !body ? (
        <div style={{ ...detailBody, color: 'var(--text-muted)', fontStyle: 'italic' }}>{t('detailNoAnswer')}</div>
      ) : (
        <div style={detailBody}>{body}</div>
      )}
    </div>
  );
}

/** Human-readable cause for each way a pinned teacher can produce nothing. */
const FAULT_KEY: Record<EvermindTeacherSkipReason, string> = {
  not_pinned: 'faultNotPinned',
  budget_exhausted: 'faultBudget',
  input_too_short: 'faultTooShort',
  gateway_error: 'faultGateway',
  empty_output: 'faultEmpty',
  exception: 'faultException',
  unknown: 'faultUnknown',
};

/** The actionable warning shown when teacher distillation failed: which model was asked,
 *  why it produced nothing, and what to do. Without this the failure is invisible — the
 *  row just silently shows un-distilled text. */
function TeacherFaultNotice({ entry, t }: { entry: ListedEntry; t: ReturnType<typeof useTranslations> }) {
  const status = evermindLearnedStatus(entry);
  if (status.state !== 'fault') return null;
  return (
    <div
      role="status"
      style={{
        display: 'flex', flexDirection: 'column', gap: 6,
        padding: '10px 12px', borderRadius: 8,
        border: '1px solid var(--warning-border, var(--border-subtle))',
        background: 'var(--warning-bg, var(--bg-elevated))',
      }}
    >
      <strong style={{ fontSize: '0.78rem', color: 'var(--warning-text, var(--text-primary))' }}>
        {t('faultTitle')}
      </strong>
      <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
        {status.teacherModel
          ? t('faultBodyWithModel', { model: status.teacherModel, reason: t(FAULT_KEY[status.reason]) })
          : t('faultBody', { reason: t(FAULT_KEY[status.reason]) })}
      </span>
      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>{t('faultHint')}</span>
    </div>
  );
}

function DetailChip({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', padding: '3px 10px', borderRadius: 999, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      {value && <strong style={{ color: 'var(--text-primary)' }}>{value}</strong>}
    </span>
  );
}

/* ── Styles (theme tokens only) ─────────────────────────────────────────────── */

const rootStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 10, height: '100%', minHeight: 0,
  background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
  borderRadius: 14, padding: '16px 18px', color: 'var(--text-primary)',
};
const rowStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
  borderRadius: 8, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4,
};
const noteStyle: React.CSSProperties = {
  margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic', lineHeight: 1.5,
};
const metaText: React.CSSProperties = { fontSize: '0.68rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' };
const filterChip: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', fontWeight: 600,
  padding: '2px 8px', borderRadius: 999, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-elevated)', color: 'var(--text-secondary)', cursor: 'pointer', maxWidth: '100%',
};
const methodChip: React.CSSProperties = {
  fontSize: '0.66rem', fontWeight: 600, color: 'var(--text-muted)',
  padding: '1px 8px', borderRadius: 999, border: '1px solid var(--border-subtle)',
};
const primaryBadgeStyle: React.CSSProperties = {
  fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
  padding: '1px 6px', borderRadius: 5, color: '#fff', background: 'var(--coral-bright, #ff6b5e)',
};
/** The "not distilled" badge — a warning, so it must read in BOTH themes: the amber
 *  tokens carry their own fallbacks rather than assuming a dark surface. */
const faultBadgeStyle: React.CSSProperties = {
  fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
  padding: '1px 6px', borderRadius: 5,
  color: 'var(--warning-text, #92400e)',
  background: 'var(--warning-bg, #fef3c7)',
  border: '1px solid var(--warning-border, #f59e0b)',
};
const detailLinkStyle: React.CSSProperties = {
  alignSelf: 'flex-start', padding: 0, fontSize: '0.7rem', fontWeight: 600, border: 'none',
  background: 'transparent', color: 'var(--coral-bright, #ff6b5e)', cursor: 'pointer',
};
const tuneLinkStyle: React.CSSProperties = {
  alignSelf: 'flex-start', fontSize: '0.76rem', fontWeight: 600, textDecoration: 'none',
  padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-elevated)', color: 'var(--text-primary)',
};
const detailSectionLabel: React.CSSProperties = {
  fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6,
};
const detailBody: React.CSSProperties = {
  fontSize: '0.85rem', lineHeight: 1.6, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '12px 14px',
};
function tagStyle(isDelta: boolean): React.CSSProperties {
  return {
    fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
    padding: '1px 6px', borderRadius: 5, border: '1px solid var(--border-subtle)',
    color: isDelta ? 'var(--text-muted)' : 'var(--coral-bright, #ff6b5e)', background: 'var(--bg-surface)',
  };
}
