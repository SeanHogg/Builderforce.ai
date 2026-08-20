'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RoleGate } from '@/components/RoleGate';
import { Select } from '@/components/Select';
import { usePermission } from '@/lib/rbac';
import { toolsApi } from '@/lib/builderforceApi';
import { ToolResultView } from '@/components/tools/ToolResultView';
import type { ToolResult, SavedToolRun } from '@/lib/tools';
import { useFormat } from "@/i18n/useFormat";

const card: React.CSSProperties = { background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 18 };
const btnSubtle: React.CSSProperties = {
  padding: '9px 16px', fontSize: 13, fontWeight: 600, borderRadius: 'var(--radius-md)',
  background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)', cursor: 'pointer', whiteSpace: 'nowrap',
};

/**
 * Windows a data-driven diagnostic can be scored over.
 *
 * The API has always accepted any window from 7 to 365 days; this panel asked for
 * 90 and only 90, so every telemetry-derived score on the platform described one
 * quarter and there was no way to ask a different question. That is the wrong
 * fixed answer for both ends of the range — a team that deploys twice a day has
 * its last sprint drowned in three months of history, and a quarterly board
 * review cannot see the year. The API's own clamp (7…365) is the bound; these are
 * the windows worth one click.
 */
const WINDOW_DAYS = [30, 90, 180, 365] as const;
const DEFAULT_WINDOW_DAYS = 90;

/**
 * The "from your data" mode for a tool that has a telemetry-derived provider.
 * Self-gating on `tools.runDataDriven` (manager+) — it shows the panel disabled
 * with a "Requires Manager role" hint rather than hiding it, and only fetches
 * the workspace's data when the caller is actually entitled.
 */
export function DataDrivenPanel({ toolId, projectId, framework }: {
  toolId: string;
  projectId?: number | null;
  /** The maturity lens the scorecard is reported under. Owned by the runner so
   *  the self-assessment and this panel can never disagree about the taxonomy. */
  framework?: string;
}) {
  const fmt = useFormat();
  const t = useTranslations('tools');
  const { allowed } = usePermission('tools.runDataDriven');
  const [result, setResult] = useState<ToolResult | null>(null);
  const [history, setHistory] = useState<SavedToolRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snap, setSnap] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [days, setDays] = useState<number>(DEFAULT_WINDOW_DAYS);

  useEffect(() => {
    if (!allowed) return;
    setLoading(true);
    // A saved snapshot records the window it was scored over, so re-reading the
    // history on a window change would be wrong — the history is every snapshot,
    // not this window's. Only the live result re-computes.
    Promise.all([
      toolsApi.dataDriven(toolId, days, projectId, framework).then((r) => r.result).catch(() => null),
      toolsApi.runs(toolId, projectId).catch(() => [] as SavedToolRun[]),
    ])
      .then(([res, h]) => { setResult(res); setHistory(h); })
      .catch((e) => setError(e instanceof Error ? e.message : t('loadFailed')))
      .finally(() => setLoading(false));
  }, [allowed, toolId, projectId, days, framework, t]);

  const saveSnapshot = async () => {
    setSnap('saving');
    try {
      // The snapshot is scored over the window on screen — saving a 90-day figure
      // while the reader is looking at a 30-day one is how a history stops meaning
      // anything.
      const run = await toolsApi.saveData(toolId, days, projectId);
      setHistory((h) => [run, ...h]);
      setSnap('saved');
    } catch {
      setSnap('idle');
    }
  };

  return (
    <RoleGate capability="tools.runDataDriven" variant="block">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', margin: 0, flex: '1 1 240px' }}>{t('dataIntro')}</p>
          <Select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label={t('windowLabel')}
            style={{
              padding: '6px 10px', fontSize: 'var(--font-size-small)', borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)',
            }}
          >
            {WINDOW_DAYS.map((d) => <option key={d} value={d}>{t('windowDays', { n: d })}</option>)}
          </Select>
        </div>

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
            <h3 style={{ fontSize: 'var(--font-size-small)', fontWeight: 700, color: 'var(--text-strong)', margin: '0 0 12px' }}>{t('history')}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {history.map((h) => (
                <div key={h.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 'var(--font-size-small)', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {fmt.date(h.createdAt)} · {h.kind === 'data' ? t('modeData') : t('modeSelf')}
                    {typeof h.input?.days === 'number' && ` · ${t('windowDays', { n: h.input.days })}`}
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
