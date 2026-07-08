'use client';

/**
 * EvermindLearnings — the "Recently learned" list, RELOCATED out of the left build
 * form into the center stage beside the Knowledge Map, and made filterable by
 * region: clicking a brain region (or legend chip) narrows this list to that
 * region's knowledge. Neocortex → `delta` runs, Hippocampus → `text` (taught / run /
 * Brain-chat) contributions; the limbic + Personality regions carry live affective
 * state rather than discrete memories, so selecting one shows a short note instead of
 * a list. Reads the SAME contributions payload the map does (passed in — no extra
 * fetch). Themed + localized; the `--ev-*` region hues cascade from the `.ev-studio`
 * ancestor.
 */

import { useMemo } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { ProjectEvermindContributions, ProjectEvermindRecentEntry } from '@/lib/projectEvermindApi';
import {
  REGION_HUE_VAR, recentForRegion, regionAccretes,
  type EvermindRegionKey,
} from '@/lib/evermindRegions';

export function EvermindLearnings({
  data, selectedRegion, onClearRegion,
}: {
  data: ProjectEvermindContributions | null;
  selectedRegion: EvermindRegionKey | null;
  onClearRegion: () => void;
}) {
  const t = useTranslations('evermindBrain');
  const format = useFormatter();

  const recent = data?.recent ?? [];
  const accretes = selectedRegion ? regionAccretes(selectedRegion) : null;
  // What to list: a memory region → its kind; no selection → everything; a limbic/
  // personality region → nothing (it carries live state, not discrete memories).
  const entries = useMemo<ProjectEvermindRecentEntry[]>(() => {
    if (!selectedRegion) return recent;
    return accretes ? recentForRegion(recent, selectedRegion) : [];
  }, [recent, selectedRegion, accretes]);

  const regionLabel = selectedRegion ? t(selectedRegion) : null;
  const isStateRegion = selectedRegion != null && !accretes; // limbic / personality

  return (
    <section style={rootStyle} aria-label={t('learningsTitle')}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
        <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.95rem' }}>{t('learningsTitle')}</h3>
        {selectedRegion ? (
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
          <p style={noteStyle}>{t('learningsRegionNote', { region: regionLabel ?? '' })}</p>
        ) : entries.length === 0 ? (
          <p style={noteStyle}>
            {selectedRegion ? t('learningsEmptyRegion', { region: regionLabel ?? '' }) : t('learningsEmptyAll')}
          </p>
        ) : (
          entries.map((e, i) => (
            <LearningRow key={`${e.version}-${e.at}-${i}`} entry={e} when={format.relativeTime(new Date(e.at))}
              kindLabel={e.kind === 'delta' ? t('nodeDelta') : t('nodeText')} deltaBody={t('deltaBody')} />
          ))
        )}
      </div>
    </section>
  );
}

function LearningRow({
  entry, when, kindLabel, deltaBody,
}: {
  entry: ProjectEvermindRecentEntry; when: string; kindLabel: string; deltaBody: string;
}) {
  const body = entry.kind === 'delta' ? deltaBody : (entry.text ?? '');
  return (
    <div style={rowStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={tagStyle(entry.kind === 'delta')}>{kindLabel}</span>
        <span style={metaText}>v{entry.version}</span>
        <span style={metaText}>×{entry.weight}</span>
        <span style={{ ...metaText, marginLeft: 'auto' }}>{when}</span>
      </div>
      {entry.prompt && <div style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-word' }}>{entry.prompt}</div>}
      {body && <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.45, wordBreak: 'break-word', whiteSpace: 'pre-wrap', maxHeight: 72, overflow: 'hidden' }}>{body}</div>}
    </div>
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
  borderRadius: 8, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 3,
};
const noteStyle: React.CSSProperties = {
  margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic', lineHeight: 1.5,
};
const metaText: React.CSSProperties = { fontSize: '0.68rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' };
const filterChip: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', fontWeight: 600,
  padding: '2px 8px', borderRadius: 999, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-elevated)', color: 'var(--text-secondary)', cursor: 'pointer',
};
function tagStyle(isDelta: boolean): React.CSSProperties {
  return {
    fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
    padding: '1px 6px', borderRadius: 5, border: '1px solid var(--border-subtle)',
    color: isDelta ? 'var(--text-muted)' : 'var(--coral-bright, #ff6b5e)', background: 'var(--bg-surface)',
  };
}
