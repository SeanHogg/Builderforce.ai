'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { contrastText } from '@/lib/contrastText';
import { type ViewMode } from '@/components/ViewToggle';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import { SkeletonGrid } from './SkeletonGrid';
import {
  getModelCatalog,
  formatPricePerMillion,
  formatContext,
  tierColor,
  type ModelRecord,
} from '@/lib/modelCatalog';

const MAX_COMPARE = 3;

type TierFilter = 'all' | 'free' | 'paid' | 'builderforce';

/**
 * The live model catalog ("Models") is a category of the marketplace — this
 * component renders it, driven by the marketplace's shared search box + view
 * toggle. Moved verbatim from the retired standalone /models page, minus its own
 * heading / search input / view toggle (the marketplace owns those now).
 */
interface FieldSpec {
  label: string;
  render: (m: ModelRecord) => React.ReactNode;
}

/** Single source of truth for the comparable attributes of a model — reused by
 *  BOTH the slide-out detail panel and the comparison table so the two never
 *  drift on what "the spec" of a model is. */
function useFieldSpecs(): FieldSpec[] {
  const t = useTranslations('models');
  return useMemo<FieldSpec[]>(() => [
    { label: t('field.provider'), render: (m) => m.provider },
    { label: t('field.inputPrice'), render: (m) => `${formatPricePerMillion(m.pricing.prompt)} / 1M` },
    { label: t('field.outputPrice'), render: (m) => `${formatPricePerMillion(m.pricing.completion)} / 1M` },
    { label: t('field.contextWindow'), render: (m) => formatContext(m) },
    { label: t('field.modality'), render: (m) => m.modality ?? '—' },
    { label: t('field.tools'), render: (m) => (m.supportedParameters?.includes('tools') ? '✅' : '—') },
    { label: t('field.reasoning'), render: (m) => (m.supportedParameters?.includes('reasoning') ? '✅' : '—') },
    { label: t('field.imageInput'), render: (m) => (m.inputModalities?.includes('image') ? '✅' : '—') },
    { label: t('field.routable'), render: (m) => (m.isBuilderforce ? '✅' : m.routable ? `✅ ${m.pool ?? ''}`.trim() : '—') },
  ], [t]);
}

function Badge({ record }: { record: ModelRecord }) {
  if (!record.badge && !record.isBuilderforce) return null;
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        padding: '2px 8px',
        borderRadius: 99,
        background: tierColor(record),
        color: contrastText(tierColor(record)),
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      {record.badge ?? (record.isBuilderforce ? 'Builderforce' : '')}
    </span>
  );
}

/** "Routable on Builderforce" chip — shown for upstream models our cascade
 *  actually serves (our own Free/Pro products carry their own badge). */
function RoutableChip({ record }: { record: ModelRecord }) {
  const t = useTranslations('models');
  if (record.isBuilderforce || !record.routable) return null;
  return (
    <span
      title={t('routableChip.title')}
      style={{
        fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
        background: 'rgba(34,197,94,0.12)', color: '#16a34a',
        border: '1px solid rgba(34,197,94,0.35)', whiteSpace: 'nowrap',
      }}
    >
      ✓ {t('routableChip.label')}{record.pool ? ` · ${record.pool}` : ''}
    </span>
  );
}

function PriceTag({ record }: { record: ModelRecord }) {
  const t = useTranslations('models');
  const free = record.pricing.prompt <= 0 && record.pricing.completion <= 0;
  if (free) {
    return (
      <span style={{ fontSize: 12, fontWeight: 700, color: '#22c55e', background: 'rgba(34,197,94,0.1)', padding: '2px 8px', borderRadius: 6, border: '1px solid rgba(34,197,94,0.3)' }}>
        {t('price.free')}
      </span>
    );
  }
  return (
    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
      <strong style={{ color: 'var(--text-primary)' }}>{formatPricePerMillion(record.pricing.prompt)}</strong> {t('price.in')} ·{' '}
      <strong style={{ color: 'var(--text-primary)' }}>{formatPricePerMillion(record.pricing.completion)}</strong> {t('price.out')} / 1M
    </span>
  );
}

// ---------------------------------------------------------------------------
// Detail slide-out content
// ---------------------------------------------------------------------------

function ModelDetail({ record }: { record: ModelRecord }) {
  const t = useTranslations('models');
  const fieldSpecs = useFieldSpecs();
  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Badge record={record} />
        <RoutableChip record={record} />
        <code style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{record.id}</code>
      </div>

      {record.description && (
        <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--text-secondary)', margin: 0 }}>{record.description}</p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--border-subtle)', border: '1px solid var(--border-subtle)', borderRadius: 12, overflow: 'hidden' }}>
        {fieldSpecs.map((f) => (
          <div key={f.label} style={{ background: 'var(--bg-elevated)', padding: '12px 14px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{f.label}</div>
            <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 600 }}>{f.render(record)}</div>
          </div>
        ))}
      </div>

      {record.supportedParameters && record.supportedParameters.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>{t('detail.supportedParameters')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {record.supportedParameters.map((p) => (
              <span key={p} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', fontFamily: 'var(--font-mono)' }}>
                {p}
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!record.isBuilderforce && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{t('detail.routedBlurb')}</p>
        )}
        <Link
          href={record.isBuilderforce ? (record.ctaHref ?? '/register') : '/pricing?upgrade=pro'}
          className="btn btn-primary"
          style={{ textDecoration: 'none', padding: '10px 20px', alignSelf: 'flex-start' }}
        >
          {record.isBuilderforce
            ? record.tier === 'PRO'
              ? t('detail.upgradeToPro')
              : t('detail.getStartedFree')
            : t('detail.useViaPro')}
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comparison table modal
// ---------------------------------------------------------------------------

function CompareModal({ models, onClose }: { models: ModelRecord[]; onClose: () => void }) {
  const t = useTranslations('models');
  const fieldSpecs = useFieldSpecs();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // Rendered only after a user click (compareOpen starts false), so document is
  // always present here; guard purely for SSR/type safety.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('compare.dialogLabel')}
        onClick={(e) => e.stopPropagation()}
        style={{
          border: '1px solid var(--border-subtle)',
          borderRadius: 16,
          width: 'min(900px, 96vw)',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 20px 50px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <div style={{ flex: 1, fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>
            {t('compare.comparingCount', { count: models.length })}
          </div>
          <button type="button" onClick={onClose} aria-label={t('compare.closeAria')} className="btn btn-secondary" style={{ padding: '6px 12px' }}>
            {t('compare.close')}
          </button>
        </div>
        <div style={{ overflow: 'auto', minHeight: 0 }}>
          <table style={{ ...tableStyle, minWidth: 520 }}>
            <thead>
              <tr style={theadRowStyle}>
                <th style={{ ...thStyle, position: 'sticky', left: 0, background: 'var(--bg-elevated)', minWidth: 150 }}>{t('compare.attribute')}</th>
                {models.map((m) => (
                  <th key={m.id} style={{ ...thStyle, textAlign: 'left', minWidth: 160 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ color: 'var(--text-primary)' }}>{m.name}</span>
                      <Badge record={m} />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fieldSpecs.map((f) => (
                <tr key={f.label} style={trStyle}>
                  <td style={{ ...tdMutedStyle, position: 'sticky', left: 0, background: 'var(--bg-elevated)', fontWeight: 600 }}>{f.label}</td>
                  {models.map((m) => (
                    <td key={m.id} style={tdStyle}>{f.render(m)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Compare tray — fixed, NON-blocking dock so the user keeps picking cards.
// Decides its own visibility (renders nothing when no selection).
// ---------------------------------------------------------------------------

function CompareTray({
  selected,
  onRemove,
  onClear,
  onCompare,
}: {
  selected: ModelRecord[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onCompare: () => void;
}) {
  const t = useTranslations('models');
  if (selected.length === 0) return null;
  return (
    <div
      role="region"
      aria-label={t('compare.selectedRegionLabel')}
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 9000,
        width: 'min(320px, calc(100vw - 32px))',
        background: 'var(--panel-drawer-bg, var(--bg-elevated))',
        border: '1px solid var(--border-subtle)',
        borderRadius: 14,
        boxShadow: '0 12px 32px rgba(0,0,0,0.28)',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
        <strong style={{ flex: 1, fontSize: 14, color: 'var(--text-primary)' }}>
          {t('compare.title')} <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>({selected.length}/{MAX_COMPARE})</span>
        </strong>
        <button type="button" onClick={onClear} className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }}>
          {t('compare.clear')}
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, maxHeight: 220, overflow: 'auto' }}>
        {selected.map((m) => (
          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: 'var(--bg-base)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
            <button
              type="button"
              onClick={() => onRemove(m.id)}
              aria-label={t('compare.removeAria', { name: m.name })}
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1, padding: 2 }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div style={{ padding: 10, borderTop: '1px solid var(--border-subtle)' }}>
        <button
          type="button"
          onClick={onCompare}
          disabled={selected.length < 2}
          className="btn btn-primary"
          style={{ width: '100%', padding: '10px 0', opacity: selected.length < 2 ? 0.5 : 1 }}
          title={selected.length < 2 ? t('compare.needTwoTitle') : t('compare.compareTitle')}
        >
          {t('compare.button')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function ModelCard({
  record,
  checked,
  checkboxDisabled,
  onToggleCheck,
  onSelect,
}: {
  record: ModelRecord;
  checked: boolean;
  checkboxDisabled: boolean;
  onToggleCheck: () => void;
  onSelect: () => void;
}) {
  const t = useTranslations('models');
  return (
    <div
      className="card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        position: 'relative',
        outline: checked ? `2px solid ${tierColor(record)}` : 'none',
        outlineOffset: -1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{record.name}</span>
            <Badge record={record} />
            <RoutableChip record={record} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{record.provider}</div>
        </div>
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: checkboxDisabled ? 'not-allowed' : 'pointer', flexShrink: 0 }}
          title={checkboxDisabled ? t('compare.maxTitle', { max: MAX_COMPARE }) : t('compare.addTitle')}
        >
          <input
            type="checkbox"
            checked={checked}
            disabled={checkboxDisabled}
            onChange={onToggleCheck}
            aria-label={t('compare.compareAria', { name: record.name })}
            style={{ width: 16, height: 16, cursor: checkboxDisabled ? 'not-allowed' : 'pointer', accentColor: tierColor(record) }}
          />
        </label>
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0, flex: 1, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {record.description || t('card.noDescription')}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
        <span title={t('field.contextWindow')}>🧠 {formatContext(record)}</span>
        <PriceTag record={record} />
      </div>

      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
        <button type="button" onClick={onSelect} className="btn btn-secondary" style={{ width: '100%', padding: '8px 0' }}>
          {t('card.selectViewDetails')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Explorer
// ---------------------------------------------------------------------------

export function ModelsExplorer({ search, viewMode }: { search: string; viewMode: ViewMode }) {
  const t = useTranslations('models');
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const [routableOnly, setRoutableOnly] = useState(false);

  const [detail, setDetail] = useState<ModelRecord | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  // Lazy: this component only mounts when the Models tab is opened, so the catalog
  // fetch never runs on the marketplace's initial paint. The gateway route caches
  // the upstream list server-side (read-through L1/L2).
  useEffect(() => {
    let active = true;
    getModelCatalog()
      .then((list) => {
        if (!active) return;
        setModels(list);
        if (list.length <= 2) setError(t('catalogUnavailable'));
      })
      .catch(() => active && setError(t('loadFailed')))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [t]);

  const toggleCheck = useCallback((id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_COMPARE) return prev;
      return [...prev, id];
    });
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return models.filter((m) => {
      if (tierFilter === 'builderforce' && !m.isBuilderforce) return false;
      if (tierFilter === 'free' && !(m.pricing.prompt <= 0 && m.pricing.completion <= 0)) return false;
      if (tierFilter === 'paid' && (m.pricing.prompt <= 0 && m.pricing.completion <= 0)) return false;
      // "Routable only": our own products always qualify; upstream models only if
      // the cascade actually routes them.
      if (routableOnly && !m.isBuilderforce && !m.routable) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q)
      );
    });
  }, [models, search, tierFilter, routableOnly]);

  // Builderforce records always lead, regardless of search ordering.
  const ordered = useMemo(() => {
    const bf = filtered.filter((m) => m.isBuilderforce);
    const rest = filtered.filter((m) => !m.isBuilderforce);
    return [...bf, ...rest];
  }, [filtered]);

  // Preserve selection order (matches checkbox order) for the tray + table.
  const selectedModels = useMemo(
    () => selectedIds.map((id) => models.find((m) => m.id === id)).filter((m): m is ModelRecord => Boolean(m)),
    [selectedIds, models],
  );

  const maxedOut = selectedIds.length >= MAX_COMPARE;

  const filters: { id: TierFilter; label: string }[] = [
    { id: 'all', label: t('filter.all') },
    { id: 'free', label: t('filter.free') },
    { id: 'paid', label: t('filter.paid') },
    { id: 'builderforce', label: t('filter.builderforce') },
  ];

  return (
    <div>
      {/* Model-specific sub-filters (tier + routable) — the marketplace bar above
          owns the shared search box, category chips and view toggle. */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }} role="group" aria-label={t('filter.tierGroup')}>
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setTierFilter(f.id)}
            aria-pressed={tierFilter === f.id}
            className={tierFilter === f.id ? 'btn btn-primary' : 'btn btn-secondary'}
            style={{ padding: '8px 14px', borderRadius: 8, fontSize: 13 }}
          >
            {f.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setRoutableOnly((v) => !v)}
          aria-pressed={routableOnly}
          title={t('filter.routableOnlyTitle')}
          className={routableOnly ? 'btn btn-primary' : 'btn btn-secondary'}
          style={{ padding: '8px 14px', borderRadius: 8, fontSize: 13 }}
        >
          ✓ {t('filter.routableOnly')}
        </button>
      </div>

      {loading ? (
        <SkeletonGrid />
      ) : (
        <>
          {error && (
            <div style={{ marginBottom: 16, padding: '10px 14px', fontSize: 13, color: 'var(--text-secondary)', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
              {error}
            </div>
          )}

          {ordered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>{t('empty')}</div>
          ) : viewMode === 'table' ? (
            <div style={tableWrapStyle}>
              <table style={tableStyle}>
                <thead>
                  <tr style={theadRowStyle}>
                    <th style={{ ...thStyle, width: 40 }} aria-label={t('table.compareAria')} />
                    <th style={thStyle}>{t('table.model')}</th>
                    <th style={thStyle}>{t('table.provider')}</th>
                    <th style={thStyle}>{t('table.context')}</th>
                    <th style={thStyle}>{t('table.input')}</th>
                    <th style={thStyle}>{t('table.output')}</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>{t('table.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((m) => {
                    const checked = selectedIds.includes(m.id);
                    return (
                      <tr key={m.id} style={trStyle}>
                        <td style={tdStyle}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!checked && maxedOut}
                            onChange={() => toggleCheck(m.id)}
                            aria-label={t('compare.compareAria', { name: m.name })}
                            style={{ width: 16, height: 16, accentColor: tierColor(m) }}
                          />
                        </td>
                        <td style={tdStyle}>
                          <strong style={{ color: 'var(--text-primary)' }}>{m.name}</strong> <Badge record={m} />
                        </td>
                        <td style={tdMutedStyle}>{m.provider}</td>
                        <td style={tdMutedStyle}>{formatContext(m)}</td>
                        <td style={tdMutedStyle}>{formatPricePerMillion(m.pricing.prompt)}</td>
                        <td style={tdMutedStyle}>{formatPricePerMillion(m.pricing.completion)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDetail(m)}>
                            {t('table.details')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {ordered.map((m) => {
                const checked = selectedIds.includes(m.id);
                return (
                  <ModelCard
                    key={m.id}
                    record={m}
                    checked={checked}
                    checkboxDisabled={!checked && maxedOut}
                    onToggleCheck={() => toggleCheck(m.id)}
                    onSelect={() => setDetail(m)}
                  />
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Slide-out detail panel */}
      <SlideOutPanel open={detail != null} onClose={() => setDetail(null)} title={detail?.name}>
        {detail && <ModelDetail record={detail} />}
      </SlideOutPanel>

      {/* Right-docked, non-blocking compare tray */}
      <CompareTray
        selected={selectedModels}
        onRemove={(id) => setSelectedIds((prev) => prev.filter((x) => x !== id))}
        onClear={() => setSelectedIds([])}
        onCompare={() => setCompareOpen(true)}
      />

      {/* Comparison table modal */}
      {compareOpen && selectedModels.length >= 2 && (
        <CompareModal models={selectedModels} onClose={() => setCompareOpen(false)} />
      )}
    </div>
  );
}
