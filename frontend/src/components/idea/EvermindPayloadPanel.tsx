'use client';

import React, { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { loadEvermindPayload, boardModelFromPayload, PayloadDeliveryError } from '@builderforce/frontend/src/lib/evermindPayloadDelivery';

export interface EvermindPayloadPanelProps {
  /**
   * Project ID to load payload for.
   * For GitHub uploads containing a frontend/src/lib/payload.ts spec, pass the parsed payload.
   * When the input is a string/Form/FormField, extract projectId and fetch live.
   */
  projectIdOrPayload?: number | unknown;
  className?: string;
  sectionKey?: string;
  fallback?: ReactNode;
}

// ---------------------------------------------------------------------------

const CSS = `
.em-pf-root {
  position: relative;
  z-index: 1;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.em-pf-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.em-pf-title {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 0.88rem;
  color: var(--text-primary);
  margin: 0;
}
.em-pf-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.68rem;
  font-weight: 600;
  padding: 3px 6px;
  border-radius: 999px;
  margin: 0;
}
.em-pf-badge.ok {
  color: var(--command-dim); /* low pad from Command Orb pulsing */
  background: alpha(var(--command-dim), 0.08);
}
.em-pf-header-status {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-left: auto;
}
.em-pf-spinner {
  color: var(--command-dim);
  width: 16px;
  height: 16px;
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
.em-pf-content {
  background: var(--surface-card);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 320px;
  overflow-y: auto;
}
.em-pf-meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  background: alpha(var(--bg-deep), 0.5);
  border-radius: 10px;
}
.em-pf-label {
  font-size: 0.70rem;
  color: var(--text-muted);
}
.em-pf-value {
  font-size: 0.76rem;
  color: var(--text-primary);
  font-weight: 500;
}
.em-pf-error {
  font-size: 0.74rem;
  color: var(--danger-bright);
  background: alpha(var(--danger), 0.08);
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid alpha(var(--danger), 0.25);
}
.em-pf-empty {
  font-size: 0.74rem;
  color: var(--text-muted);
  text-align: center;
  padding: 14px 10px;
}`;
const EM_PANEL_CSS = CSS;

// ---------------------------------------------------------------------------

/**
 * EvermindPayloadPanel — board panel that renders payload data and agent-derived outputs.
 * Reactively reloads when projectIdOrPayload changes or refreshInterval elapses.
 * Fails gracefully on errors (FR-1.3, FR-4.3) and will stay on the panel.
 */
export function EvermindPayloadPanel({
  projectIdOrPayload,
  className = '',
  sectionKey = 'evermindPayload',
  fallback,
}: EvermindPayloadPanelProps) {
  const t = useTranslations('evermindPayloadPanel');
  const [projectId, setProjectId] = useState<number | null>(null);
  const [model, setModel] = useState<ReturnType<typeof boardModelFromPayload> | null>(null);
  const [error, setError] = useState<PayloadDeliveryError | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Determine whether the prop is a live requestable projectId.
    const target = typeof projectIdOrPayload === 'number' ? projectIdOrPayload : undefined;
    setProjectId(target ?? null);
    setError(null);
    setModel(null);
    setLoading(true);

    const refreshRate = 10_000; // 10s refresh for live polling.
    let timeoutId: ReturnType<typeof setTimeout>;

    const loader = async () => {
      try {
        if (target === undefined) {
          setLoading(false);
          return;
        }
        const rawPayload = await loadEvermindPayload(target);
        setModel(boardModelFromPayload(rawPayload));
      } catch (err) {
        setError(err instanceof PayloadDeliveryError ? err : new PayloadDeliveryError('network', `Unknown error: ${err instanceof Error ? err.message : String(err)}`));
      } finally {
        setLoading(false);
      }
    };

    void loader();
    timeoutId = setTimeout(() => void loader(), refreshRate);

    return () => clearTimeout(timeoutId);
  }, [projectIdOrPayload]);

  const sectionLabel = t('sectionLabel');
  const title = sectionLabel;

  if (fallback) {
    return <React.Fragment>{fallback}</React.Fragment>;
  }

  if (!projectId) {
    return (
      <div style={{ marginTop: 4 }}>
        <style>{EM_PANEL_CSS}</style>
        <div className={`evermind-payload-root em-pf-root ${className}`}>
          <div className="em-pf-error">{t('noPayload')}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 4 }}>
      <style>{EM_PANEL_CSS}</style>
      <div className={`evermind-payload-root em-pf-root ${className}`}>
        {model ? (
          <>
            <header className="em-pf-header">
              <h1 className="em-pf-title">{title}</h1>
              <div className="em-pf-badge ok">{model.grdLabel}</div>
              <span className="em-pf-header-status">{model.lastLearnedAt}</span>
            </header>
            <div className="em-pf-content">
              <div className="em-pf-meta">
                <span className="em-pf-label">{t('versionLabel')}</span>
                <span className="em-pf-value">{model.version}</span>
              </div>
              <div className="em-pf-meta">
                <span className="em-pf-label">{t('contributionsLabel')}</span>
                <span className="em-pf-value">{model.contributions}</span>
              </div>
              <div className="em-pf-meta">
                <span className="em-pf-label">{t('pendingLabel')}</span>
                <span className="em-pf-value">{model.pending}</span>
              </div>
              <div className="em-pf-meta">
                <span className="em-pf-label">{t('inferenceLabel')}</span>
                <span className="em-pf-value">{model.inferenceEnabled ? t('on') : t('off')}</span>
              </div>
              {model.teacherModel && (
                <div className="em-pf-meta">
                  <span className="em-pf-label">{t('teacherLabel')}</span>
                  <span className="em-pf-value">{model.teacherModel}</span>
                </div>
              )}
            </div>
            <div className="em-pf-content">
              {[
                { label: 'valence', value: model.gradDisplay.valence, unit: '×1.0' },
                { label: 'arousal', value: model.gradDisplay.arousal, unit: '×1.0' },
                { label: 'attention', value: model.gradDisplay.attention, unit: '×1.0' },
              ].map((card, idx) => (
                <div key={idx} className="em-pf-meta">
                  <span className="em-pf-label">{card.label}</span>
                  <span className="em-pf-value">{card.value} {card.unit}</span>
                </div>
              ))}
            </div>
          </>
        ) : loading ? (
          <>
            <header className="em-pf-header">
              <span className="em-pf-title">{title}</span>
              <span className="em-pf-header-status">{t('loading')}</span>
            </header>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, minHeight: 24, marginTop: 6 }}>
              <div className="em-pf-spinner" aria-label={t('loading')} />
              <span style={{ fontSize: 0.75, color: 'var(--text-muted)' }}>{t('loading')}</span>
            </div>
          </>
        ) : error ? (
          <>
            <header className="em-pf-header">
              <span className="em-pf-title">{title}</span>
              <span className="em-pf-header-status">{t('error')}</span>
            </header>
            <div className="em-pf-error">
              {error.message}
            </div>
          </>
        ) : (
          <div className="em-pf-empty">{t('noPayload')}</div>
        )}
      </div>
    </div>
  );
}