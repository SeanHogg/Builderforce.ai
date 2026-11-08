import { useRef, useState } from 'react';
import type { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { DocumentMarkdown } from '@/components/DocumentMarkdown';
import type { DocumentBlock } from '@/domains/collab/domain/blockDocument';
import { toModelText } from '@/domains/collab/domain/drawingPlaceholders';
import { knowledgeApi, type AnalysisResult } from '@/lib/knowledgeApi';
import { useErrorMessage } from '@/i18n/useErrorMessage';
import { badge, btnPrimary } from '../knowledgeStyles';

function severityColor(severity: string): React.CSSProperties {
  if (severity === 'high') return { background: 'var(--error-bg)', color: 'var(--error-text, var(--error))' };
  if (severity === 'medium') return { background: 'var(--warning-bg)', color: 'var(--warning-text, var(--amber-bright))' };
  return { background: 'var(--surface-2)', color: 'var(--text-muted)' };
}

/**
 * The AI analysis of a knowledge document: findings plus an improved flow the person can
 * apply. The model is shown the document with drawings as `[[bf-drawing:N]]` placeholders;
 * `onApplyFlow` gets the snapshot those numbers refer to so the drawings can be restored.
 */
export function AnalyzePanel({
  docId,
  t,
  getBlocks,
  onApplyFlow,
}: {
  docId: string;
  t: ReturnType<typeof useTranslations>;
  getBlocks: () => readonly DocumentBlock[];
  onApplyFlow: (flow: string, snapshot: readonly DocumentBlock[]) => void;
}) {
  const errorMessage = useErrorMessage();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The blocks the model was shown: its placeholder numbers refer to THIS snapshot, not to later edits.
  const snapshotRef = useRef<readonly DocumentBlock[]>([]);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const snapshot = getBlocks();
      setResult(await knowledgeApi.analyze(docId, toModelText(snapshot)));
      snapshotRef.current = snapshot;
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        margin: '16px 0',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '10px 16px',
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          fontWeight: 600,
        }}
      >
        <Icon source="🔍" size="1em" /> {t('analyzeTitle')} {open ? '▾' : '▸'}
      </button>
      {open && (
        <div style={{ padding: 16, paddingTop: 0 }}>
          <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginTop: 0 }}>{t('analyzeHint')}</p>
          <button type="button" onClick={run} disabled={busy} style={btnPrimary}>
            {busy ? t('analyzing') : t('analyzeRun')}
          </button>
          {error && <div style={{ color: 'var(--error-text, var(--error))', marginTop: 8 }}>{error}</div>}
          {result && (
            <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
              {result.summary && <p style={{ margin: 0, fontSize: 'var(--font-size-body)' }}>{result.summary}</p>}
              {result.findings.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>{t('analyzeNoFindings')}</div>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {result.findings.map((f, i) => (
                    <div
                      key={i}
                      style={{ padding: 12, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--surface-2)' }}
                    >
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ ...badge, ...severityColor(f.severity) }}>{t(`severity_${f.severity}`)}</span>
                        <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t(`category_${f.category}`)}</span>
                      </div>
                      <div style={{ fontSize: 'var(--font-size-body)', fontWeight: 600 }}>{f.issue}</div>
                      {f.recommendation && (
                        <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginTop: 4 }}>
                          → {f.recommendation}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {result.improvedFlow && (
                <div>
                  <div style={{ fontSize: 'var(--font-size-small)', fontWeight: 600, margin: '4px 0 6px' }}>{t('analyzeImprovedFlow')}</div>
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border)',
                      background: 'var(--surface-2)',
                      maxHeight: 220,
                      overflow: 'auto',
                    }}
                  >
                    <DocumentMarkdown content={result.improvedFlow} />
                  </div>
                  <button
                    type="button"
                    onClick={() => { onApplyFlow(result.improvedFlow, snapshotRef.current); setResult(null); }}
                    style={{ ...btnPrimary, marginTop: 8 }}
                  >
                    {t('analyzeApplyFlow')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
