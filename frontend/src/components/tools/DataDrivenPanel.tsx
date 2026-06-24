'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RoleGate } from '@/components/RoleGate';
import { usePermission } from '@/lib/rbac';
import { toolsApi } from '@/lib/builderforceApi';
import { ToolResultView } from '@/components/tools/ToolResultView';
import type { ToolResult, SavedToolRun } from '@/lib/tools';

const card: React.CSSProperties = { background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 18 };
const btnSubtle: React.CSSProperties = {
  padding: '9px 16px', fontSize: 13, fontWeight: 600, borderRadius: 8,
  background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)', cursor: 'pointer', whiteSpace: 'nowrap',
};

/**
 * The "from your data" mode for a tool that has a telemetry-derived provider.
 * Self-gating on `tools.runDataDriven` (manager+) — it shows the panel disabled
 * with a "Requires Manager role" hint rather than hiding it, and only fetches
 * the workspace's data when the caller is actually entitled.
 */
export function DataDrivenPanel({ toolId }: { toolId: string }) {
  const t = useTranslations('tools');
  const { allowed } = usePermission('tools.runDataDriven');
  const [result, setResult] = useState<ToolResult | null>(null);
  const [history, setHistory] = useState<SavedToolRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snap, setSnap] = useState<'idle' | 'saving' | 'saved'>('idle');

  useEffect(() => {
    if (!allowed) return;
    setLoading(true);
    Promise.all([
      toolsApi.dataDriven(toolId, 90).then((r) => r.result).catch(() => null),
      toolsApi.runs(toolId).catch(() => [] as SavedToolRun[]),
    ])
      .then(([res, h]) => { setResult(res); setHistory(h); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [allowed, toolId]);

  const saveSnapshot = async () => {
    setSnap('saving');
    try {
      const run = await toolsApi.saveData(toolId, 90);
      setHistory((h) => [run, ...h]);
      setSnap('saved');
    } catch {
      setSnap('idle');
    }
  };

  return (
    <RoleGate capability="tools.runDataDriven" variant="block">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>{t('dataIntro')}</p>

        {loading ? (
          <div style={{ color: 'var(--muted)', padding: 16 }}>{t('computingData')}</div>
        ) : error ? (
          <div style={{ ...card, color: 'var(--error-text)' }}>{error}</div>
        ) : result ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" onClick={saveSnapshot} disabled={snap === 'saving'} style={btnSubtle}>
                {snap === 'saving' ? t('saving') : snap === 'saved' ? t('snapshotSaved') : t('saveSnapshot')}
              </button>
            </div>
            <ToolResultView result={result} />
          </>
        ) : (
          <div style={{ color: 'var(--muted)', padding: 16 }}>{t('dataIntro')}</div>
        )}

        {history.length > 0 && (
          <div style={card}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-strong)', margin: '0 0 12px' }}>{t('history')}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {history.map((h) => (
                <div key={h.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {new Date(h.createdAt).toLocaleDateString()} · {h.kind === 'data' ? t('modeData') : t('modeSelf')}
                  </span>
                  <span style={{ fontWeight: 700, color: 'var(--text-strong)' }}>
                    {h.result?.score != null ? `${h.result.score.toFixed(1)} / 5` : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </RoleGate>
  );
}
