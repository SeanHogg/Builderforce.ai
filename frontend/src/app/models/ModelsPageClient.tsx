'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { ViewToggle, type ViewMode } from '@/components/ViewToggle';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
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
 * Single source of truth for the comparable attributes of a model. Reused by
 * BOTH the slide-out detail panel and the comparison table so the two never
 * drift on what "the spec" of a model is.
 */
interface FieldSpec {
  label: string;
  render: (m: ModelRecord) => React.ReactNode;
}

const FIELD_SPECS: FieldSpec[] = [
  { label: 'Provider', render: (m) => m.provider },
  { label: 'Input price', render: (m) => `${formatPricePerMillion(m.pricing.prompt)} / 1M` },
  { label: 'Output price', render: (m) => `${formatPricePerMillion(m.pricing.completion)} / 1M` },
  { label: 'Context window', render: (m) => formatContext(m) },
  { label: 'Modality', render: (m) => m.modality ?? '—' },
  {
    label: 'Tools / functions',
    render: (m) => (m.supportedParameters?.includes('tools') ? '✅' : '—'),
  },
  {
    label: 'Reasoning',
    render: (m) => (m.supportedParameters?.includes('reasoning') ? '✅' : '—'),
  },
  {
    label: 'Image input',
    render: (m) => (m.inputModalities?.includes('image') ? '✅' : '—'),
  },
];

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
        color: '#fff',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      {record.badge ?? (record.isBuilderforce ? 'Builderforce' : '')}
    </span>
  );
}

function PriceTag({ record }: { record: ModelRecord }) {
  const free = record.pricing.prompt <= 0 && record.pricing.completion <= 0;
  if (free) {
    return (
      <span style={{ fontSize: 12, fontWeight: 700, color: '#22c55e', background: 'rgba(34,197,94,0.1)', padding: '2px 8px', borderRadius: 6, border: '1px solid rgba(34,197,94,0.3)' }}>
        Free
      </span>
    );
  }
  return (
    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
      <strong style={{ color: 'var(--text-primary)' }}>{formatPricePerMillion(record.pricing.prompt)}</strong> in ·{' '}
      <strong style={{ color: 'var(--text-primary)' }}>{formatPricePerMillion(record.pricing.completion)}</strong> out / 1M
    </span>
  );
}

// ---------------------------------------------------------------------------
// Detail slide-out content
// ---------------------------------------------------------------------------

function ModelDetail({ record }: { record: ModelRecord }) {
  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Badge record={record} />
        <code style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{record.id}</code>
      </div>

      {record.description && (
        <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--text-secondary)', margin: 0 }}>{record.description}</p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--border-subtle)', border: '1px solid var(--border-subtle)', borderRadius: 12, overflow: 'hidden' }}>
        {FIELD_SPECS.map((f) => (
          <div key={f.label} style={{ background: 'var(--bg-elevated)', padding: '12px 14px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{f.label}</div>
            <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 600 }}>{f.render(record)}</div>
          </div>
        ))}
      </div>

      {record.supportedParameters && record.supportedParameters.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>Supported parameters</div>
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
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
            Routed through Builderforce.ai Pro at the same per-token price — one OpenAI-compatible endpoint, with
            failover, prompt caching and usage metering.
          </p>
        )}
        <Link
          href={record.isBuilderforce ? (record.ctaHref ?? '/register') : '/pricing?upgrade=pro'}
          className="btn btn-primary"
          style={{ textDecoration: 'none', padding: '10px 20px', alignSelf: 'flex-start' }}
        >
          {record.isBuilderforce
            ? record.tier === 'PRO'
              ? 'Upgrade to Pro'
              : 'Get started free'
            : 'Use via Builderforce.ai Pro'}
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comparison table modal
// ---------------------------------------------------------------------------

function CompareModal({ models, onClose }: { models: ModelRecord[]; onClose: () => void }) {
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
        aria-label="Compare models"
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
            Comparing {models.length} models
          </div>
          <button type="button" onClick={onClose} aria-label="Close comparison" className="btn btn-secondary" style={{ padding: '6px 12px' }}>
            Close
          </button>
        </div>
        <div style={{ overflow: 'auto', minHeight: 0 }}>
          <table style={{ ...tableStyle, minWidth: 520 }}>
            <thead>
              <tr style={theadRowStyle}>
                <th style={{ ...thStyle, position: 'sticky', left: 0, background: 'var(--bg-elevated)', minWidth: 150 }}>Attribute</th>
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
              {FIELD_SPECS.map((f) => (
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
  if (selected.length === 0) return null;
  return (
    <div
      role="region"
      aria-label="Models selected for comparison"
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
          Compare <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>({selected.length}/{MAX_COMPARE})</span>
        </strong>
        <button type="button" onClick={onClear} className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }}>
          Clear
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, maxHeight: 220, overflow: 'auto' }}>
        {selected.map((m) => (
          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: 'var(--bg-base)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
            <button
              type="button"
              onClick={() => onRemove(m.id)}
              aria-label={`Remove ${m.name}`}
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
          title={selected.length < 2 ? 'Select at least 2 models to compare' : 'Compare selected models'}
        >
          Compare
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
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{record.provider}</div>
        </div>
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: checkboxDisabled ? 'not-allowed' : 'pointer', flexShrink: 0 }}
          title={checkboxDisabled ? `Up to ${MAX_COMPARE} models can be compared` : 'Add to comparison'}
        >
          <input
            type="checkbox"
            checked={checked}
            disabled={checkboxDisabled}
            onChange={onToggleCheck}
            aria-label={`Compare ${record.name}`}
            style={{ width: 16, height: 16, cursor: checkboxDisabled ? 'not-allowed' : 'pointer', accentColor: tierColor(record) }}
          />
        </label>
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0, flex: 1, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {record.description || 'No description available.'}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
        <span title="Context window">🧠 {formatContext(record)}</span>
        <PriceTag record={record} />
      </div>

      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
        <button type="button" onClick={onSelect} className="btn btn-secondary" style={{ width: '100%', padding: '8px 0' }}>
          Select & view details
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ModelsPageClient() {
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('card');

  const [detail, setDetail] = useState<ModelRecord | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  useEffect(() => {
    let active = true;
    getModelCatalog()
      .then((list) => {
        if (!active) return;
        setModels(list);
        if (list.length <= 2) setError('Live model catalog is unavailable right now — showing Builderforce.ai models only.');
      })
      .catch((e) => active && setError(e instanceof Error ? e.message : 'Failed to load models'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

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
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q)
      );
    });
  }, [models, search, tierFilter]);

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
    { id: 'all', label: 'All' },
    { id: 'free', label: 'Free' },
    { id: 'paid', label: 'Paid' },
    { id: 'builderforce', label: 'Builderforce.ai' },
  ];

  return (
    <div className="page-inner">
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <h1 style={{ fontSize: 'clamp(24px,4vw,36px)', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>Models</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, maxWidth: 560, margin: '0 auto' }}>
          Every model you can route through Builderforce.ai — our own free &amp; Pro routing first, then the full live
          catalog with up-to-date pricing. Select any model for details, or tick up to {MAX_COMPARE} to compare.
        </p>
      </div>

      <div
        style={{
          position: 'sticky',
          top: -16,
          zIndex: 15,
          background: 'color-mix(in srgb, var(--bg-base, var(--bg)) 70%, transparent)',
          backdropFilter: 'blur(6px)',
          padding: '12px 0 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 16,
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <input
          type="search"
          placeholder="Search models, providers…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search models"
          style={{ flex: 1, minWidth: 200, maxWidth: 360, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 13 }}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="group" aria-label="Filter by tier">
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
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <ViewToggle value={viewMode} onChange={setViewMode} />
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>Loading models…</div>
      ) : (
        <>
          {error && (
            <div style={{ marginBottom: 16, padding: '10px 14px', fontSize: 13, color: 'var(--text-secondary)', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
              {error}
            </div>
          )}

          {ordered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>No models match your search.</div>
          ) : viewMode === 'table' ? (
            <div style={tableWrapStyle}>
              <table style={tableStyle}>
                <thead>
                  <tr style={theadRowStyle}>
                    <th style={{ ...thStyle, width: 40 }} aria-label="Compare" />
                    <th style={thStyle}>Model</th>
                    <th style={thStyle}>Provider</th>
                    <th style={thStyle}>Context</th>
                    <th style={thStyle}>Input / 1M</th>
                    <th style={thStyle}>Output / 1M</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
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
                            aria-label={`Compare ${m.name}`}
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
                            Details
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
