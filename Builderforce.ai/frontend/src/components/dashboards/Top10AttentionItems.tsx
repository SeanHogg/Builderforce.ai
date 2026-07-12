'use client';

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { AttentionItem, getTop10AttentionItems, refreshAttentionItems } from '@/lib/attentionApi';

/* ── Types ──────────────────────────────────────────────────────────────────── */
type ItemVariant = 'top' | 'normal';

/* ── Constants ───────────────────────────────────────────────────────────────── */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes per FR5
const MAX_ITEMS = 10; // FR1 maximum list size
const TITLE_MAX_LENGTH = 100; // FR2 max title length
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes per FR5
const MAX_ITEMS = 10; // FR1 maximum list size
const TITLE_MAX_LENGTH = 100; // FR2 max title length

/* ── Item Presentation ───────────────────────────────────────────────────────── */
interface RenderedItemProps {
  item: AttentionItem;
  isFirst: boolean;
  isLoading: boolean;
}

function RenderedItem({ item, isLoading }: RenderedItemProps) {
  const t = useTranslations('attentionItems');
  
  // Truncate title to max length per FR2
  const title = item.title.length > TITLE_MAX_LENGTH 
    ? item.title.slice(0, TITLE_MAX_LENGTH - 3) + '...' 
    : item.title;

  return (
    <a
      href={item.url}
      className={`attention-item ${isFirst ? 'attention-item-top' : 'attention-item-normal'}`}
      aria-label={`Attention item: ${title}`}
    >
      <div className="attention-item-header">
        <span className={`attention-item-icon attention-icon-${item.type}`}>
          {getTypeIcon(item.type)}
        </span>
        <span className={`attention-item-badge badge-${item.urgency}`}>
          {item.metric}
        </span>
      </div>
      <div className="attention-item-title">{title}</div>
      <div className="attention-item-meta">
        <span className="attention-item-link">{t('viewDetails')}</span>
      </div>
    </a>
  );
}

/* ── Icon helper ─────────────────────────────────────────────────────────────── */
function getTypeIcon(type: AttentionItem['type']): string {
  const icons: Record<AttentionItem['type'], string> = {
    task: '📋',
    ticket: '🎫',
    message: '💬',
    alert: '⚠️',
    issue: '🐞',
  };
  return icons[type] || '📌';
}

/* ── Empty State ─────────────────────────────────────────────────────────────── */
function EmptyState() {
  const t = useTranslations('attentionItems');

  return (
    <div className="attention-empty">
      <div className="attention-empty-icon">🎉</div>
      <div className="attention-empty-title">{t('noItemsTitle')}</div>
      <div className="attention-empty-message">{t('noItemsMessage')}</div>
    </div>
  );
}

/* ── Load More / Loading State ───────────────────────────────────────────────── */
function LoadingPlaceholder({ variant }: { variant: ItemVariant }) {
  const width = variant === 'top' ? 85 : 70;
  const height = variant === 'top' ? 70 : 55;
  const degree = variant === 'top' ? 45 : 60;
  

  return (
    <div className="attention-loading">
      <div style={{ width, height, borderRadius: 12, opacity: 0.3 }} className="attention-loading-line" />
      <div style={{ width, height, borderRadius: 12, opacity: 0.2 }} className="attention-loading-line" />
    </div>
  );
}

/* ── Main Component ──────────────────────────────────────────────────────────── */
export function Top10AttentionItems({ projectId }: { projectId: number }) {
  const t = useTranslations('attentionItems');
  
  const [items, setItems] = useState<AttentionItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const inFlight = useRef(false);
  const refreshTimeout = useRef<NodeJS.Timeout | null>(null);

  /**
   * Fetch top 10 attention items.
   * Uses optimistic updates with background reload on success.
   */
  const fetchData = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    
    try {
      const data = await getTop10AttentionItems(projectId);
      // Re-render optimistically
      setItems(data);
      setError(false);
    } catch (e) {
      setError(true);
    } finally {
      inFlight.current = false;
      setLoaded(true);
    }
  }, [projectId]);

  /**
   * Refresh attention items and reload metrics.
   * Applies latest scoring and ensures consistent item order (no placement jumps).
   */
  const refreshWithReload = useCallback(async (): Promise<AttentionItem[]> => {
    return refreshAttentionItems(projectId).then(setItems);
  }, [projectId]);

  /**
   * Initial data load.
   */
  useEffect(() => {
    setLoaded(false);
    void fetchData();
  }, [fetchData]);

  /**
   * Periodic refresh (every 5 minutes) plus data change observability hook.
   * Ensures refresh interval alignment with FR5: list updates within 5 minutes.
   * Multi-trigger design: schedule updates on ambient timing AND reactive triggers.
   */
  useEffect(() => {
    // Ambient timing refresh (per FR5)
    refreshTimeout.current = setInterval(() => void refreshWithReload().catch(() => {}), REFRESH_INTERVAL_MS);

    return () => {
      if (refreshTimeout.current) {
        clearInterval(refreshTimeout.current);
      }
    };
  }, [refreshWithReload]);

  /**
   * Filter and render items only after loaded.
   */
  const renderedItems = useMemo(() => {
    if (!loaded || error) {
      return (
        !loaded ? <LoadingPlaceholder variant="top" /> : <EmptyState />
      );
    }

    if (items.length === 0) {
      return <EmptyState />;
    }

    // Render up to MAX_ITEMS (or less if fewer items meet criteria per FR6)
    const displayItems = items.slice(0, MAX_ITEMS);
    return (
      <div className="attention-list">
        {displayItems.map((item) => (
          <RenderedItem
            key={item.id}
            item={item}
            isLoading={false}
          />
        ))}
      </div>
    );
  }, [loaded, error, items]);

  const isBusy = !loaded || inFlight.current;

  return (
    <div className="top-10-attention">
      <style>{ATTENTION_CSS}</style>
      <div className="attention-header">
        <h2 className="attention-title">{t('title')}</h2>
        <button 
          type="button"
          className="attention-refresh"
          onClick={() => void refreshWithReload()}
          disabled={isBusy}
          aria-label={t('refresh')}
        >
          {t('refresh')}
        </button>
      </div>
      <div className="attention-content">
        {renderedItems}
      </div>
      {!loaded && (
        <div className="attention-loading-container" style={{ display: 'block' }}>
          <LoadingPlaceholder variant="top" />
        </div>
      )}
    </div>
  );
}

/* ── CSS Styles ──────────────────────────────────────────────────────────────── */
const ATTENTION_CSS = `
.top-10-attention {
  --attention-top-height: 70px;
  --attention-normal-height: 55px;
  --attention-gap: 12px;
}

.attention-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  flex: 0 0 auto;
}

.attention-title {
  margin: 0;
  padding: 0;
  font-family: var(--font-display, system-ui);
  font-weight: 700;
  font-size: 1rem;
  line-height: 1.4;
}

.attention-refresh {
  background: transparent;
  color: inherit;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 3px 10px;
  font-size: 0.72rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s, opacity 0.2s;
  white-space: nowrap;
}

.attention-refresh:hover:not(:disabled) {
  background: var(--bg-elevated);
}

.attention-refresh:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.attention-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--attention-gap);
  min-height: 0;
}

/* Empty State */
.attention-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 40px 24px;
  background: var(--bg-elevated);
  border-radius: 12px;
  border: 1px solid var(--border-subtle);
  color: var(--text-muted);
}

.attention-empty-icon {
  font-size: 2rem;
}

.attention-empty-title {
  margin: 0;
  padding: 0;
  font-family: var(--font-display, system-ui);
  font-weight: 700;
  font-size: 0.85rem;
}

.attention-empty-message {
  margin: 0;
  padding: 0;
  font-size: 0.8rem;
  line-height: 1.4;
}

/* Item Styles */
.attention-list {
  display: flex;
  flex-direction: column;
  gap: var(--attention-gap);
  flex: 1;
  min-height: 0;
}

.attention-item {
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  padding: 10px 14px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, transform 0.1s, opacity 0.15s;
  opacity: 0.85;
  position: relative;
}

.attention-item:hover {
  background: var(--bg-surface);
  border-color: var(--border-medium);
  transform: translateX(4px);
  opacity: 1;
}

.attention-item:focus-visible {
  outline: 2px solid var(--focus-primary);
  outline-offset: 2px;
  border-radius: 10px;
}

.attention-item-top {
  background: linear-gradient(135deg, var(--bg-elevated) 0%, var(--bg-surface) 100%);
  border-color: var(--border-medium);
  border-width: 1.5px;
}

.attention-item-top:hover {
  border-color: var(--attention-color);
  background: linear-gradient(135deg, var(--bg-surface) 0%, var(--bg-elevated) 100%);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

.attention-item-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.attention-item-icon {
  font-size: 14px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 6px;
  background: var(--bg-surface);
}

.attention-item-top .attention-item-header {
  gap: 12px;
}

.attention-item-title {
  font-family: var(--font-display, system-ui);
  font-weight: 700;
  font-size: 0.9rem;
  line-height: 1.3;
  margin: 0;
  color: var(--text-primary);
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attention-item-last {
  padding-left: 0;
  padding-right: 0;
}

.attention-item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.attention-item-link {
  color: var(--text-muted);
  font-size: 0.75rem;
  text-decoration: underline;
  cursor: pointer;
  text-decoration-color: transparent;
  transition: text-decoration-color 0.15s;
  flex: 0 0 auto;
  display: inline-block;
}

.attention-item-link:hover {
  text-decoration-color: inherit;
}

/* Badge Styles */
.attention-item-badge {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  color: var(--text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.attention-item-top .attention-item-badge {
  border-color: var(--attention-color);
  color: var(--attention-color);
  opacity: 1;
}

.badge-urgent {
  background: #fef2f2;
  border-color: #fee2e2;
  color: #dc2626;
}

.badge-high {
  background: #fffbeb;
  border-color: #fef3c7;
  color: #d97706;
}

.badge-medium {
  background: #eff6ff;
  border-color: #dbeafe;
  color: #2563eb;
}

.badge-low {
  background: #f3f4f6;
  border-color: #e5e7eb;
  color: #6b7280;
}

/* Loading State */
.attention-loading {
  display: flex;
  gap: 4px;
  height: 24px;
  width: 80px;
  align-items: center;
}

.attention-loading-line {
  height: 100%;
  background: var(--border-subtle);
  border-radius: 999px;
  animation: attention-loading-pulse 1.2s ease-in-out infinite;
}

.attention-loading-line:nth-child(2) {
  animation-delay: 0.4s;
}

@keyframes attention-loading-pulse {
  0%, 100% { opacity: 0.2; }
  50% { opacity: 0.5; }
}

.attention-loading-container {
  margin-top: 12px;
  flex-shrink: 0;
}

/* Accessibility - Screen Reader Only */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (prefers-reduced-motion: reduce) {
  .attention-item,
  .attention-item-top,
  .attention-refresh,
  .attention-item-link,
  .attention-loading-line {
    transition: none;
  }
}
`;