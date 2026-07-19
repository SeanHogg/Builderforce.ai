'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { Select } from '@/components/Select';
import { promptLibraryApi, type PromptVersion } from '@/lib/builderforceApi';
import { diffLines, diffStat, sideBySide, type DiffRow } from '@/lib/textDiff';

/**
 * PromptVersionDiff — version history + line diff for a prompt, in the canonical
 * SlideOutPanel. Lists every version and shows a unified OR side-by-side line
 * diff between any two chosen versions (defaults to previous → current). The diff
 * is computed client-side with the dependency-free LCS util in lib/textDiff.
 */

const ADD_BG = 'color-mix(in srgb, var(--success, #16a34a) 16%, transparent)';
const DEL_BG = 'color-mix(in srgb, var(--danger, #dc2626) 16%, transparent)';

export interface PromptVersionDiffProps {
  promptId: string;
  open: boolean;
  onClose: () => void;
}

export function PromptVersionDiff({ promptId, open, onClose }: PromptVersionDiffProps) {
  const t = useTranslations('promptHistory');
  const [versions, setVersions] = useState<PromptVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fromV, setFromV] = useState<number | null>(null);
  const [toV, setToV] = useState<number | null>(null);
  const [mode, setMode] = useState<'unified' | 'split'>('unified');

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setVersions(null);
    setError(null);
    promptLibraryApi.get(promptId)
      .then((entry) => {
        if (!alive) return;
        const vs = [...(entry.versions ?? [])].sort((a, b) => a.version - b.version);
        setVersions(vs);
        const last = vs[vs.length - 1]?.version ?? null;
        const prev = vs.length > 1 ? vs[vs.length - 2].version : last;
        setFromV(prev);
        setToV(last);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [open, promptId]);

  const byVersion = useMemo(() => {
    const m = new Map<number, PromptVersion>();
    for (const v of versions ?? []) m.set(v.version, v);
    return m;
  }, [versions]);

  const rows: DiffRow[] = useMemo(() => {
    if (fromV == null || toV == null) return [];
    const a = byVersion.get(fromV)?.body ?? '';
    const b = byVersion.get(toV)?.body ?? '';
    return diffLines(a, b);
  }, [byVersion, fromV, toV]);

  const stat = useMemo(() => diffStat(rows), [rows]);

  return (
    <SlideOutPanel open={open} onClose={onClose} title={t('title')} width="min(760px, 96vw)">
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && <div style={{ color: 'var(--danger, #e5484d)' }}>{error}</div>}
        {!versions && !error && <div style={{ color: 'var(--text-muted)' }}>{t('loading')}</div>}

        {versions && versions.length > 0 && (
          <>
            {/* Version pickers + view mode */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <label style={labelCol}>
                <span style={labelText}>{t('from')}</span>
                <Select className="input" value={fromV ?? ''} onChange={(e) => setFromV(Number(e.target.value))}>
                  {versions.map((v) => <option key={v.version} value={v.version}>{t('versionN', { n: v.version })}</option>)}
                </Select>
              </label>
              <label style={labelCol}>
                <span style={labelText}>{t('to')}</span>
                <Select className="input" value={toV ?? ''} onChange={(e) => setToV(Number(e.target.value))}>
                  {versions.map((v) => <option key={v.version} value={v.version}>{t('versionN', { n: v.version })}</option>)}
                </Select>
              </label>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button type="button" className={`btn btn-sm ${mode === 'unified' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('unified')}>{t('unified')}</button>
                <button type="button" className={`btn btn-sm ${mode === 'split' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('split')}>{t('split')}</button>
              </div>
            </div>

            {/* Diff summary */}
            <div style={{ display: 'flex', gap: 14, fontSize: 12 }}>
              <span style={{ color: 'var(--success, #16a34a)', fontWeight: 700 }}>+{stat.added} {t('added')}</span>
              <span style={{ color: 'var(--danger, #dc2626)', fontWeight: 700 }}>−{stat.removed} {t('removed')}</span>
              <span style={{ color: 'var(--text-muted)' }}>{t('unchanged', { n: stat.unchanged })}</span>
            </div>

            {/* Diff body */}
            <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
              {mode === 'unified' ? <UnifiedDiff rows={rows} /> : <SplitDiff rows={rows} />}
            </div>

            {/* Version notes list */}
            <div>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>{t('allVersions')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[...versions].reverse().map((v) => (
                  <div key={v.version} style={{ display: 'flex', gap: 10, fontSize: 13, color: 'var(--text-muted)' }}>
                    <span style={{ fontWeight: 700, color: 'var(--text-primary)', minWidth: 44 }}>{t('versionN', { n: v.version })}</span>
                    <span style={{ whiteSpace: 'nowrap' }}>{new Date(v.createdAt).toLocaleDateString()}</span>
                    {v.notes && <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.notes}</span>}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {versions && versions.length === 0 && <div style={{ color: 'var(--text-muted)' }}>{t('empty')}</div>}
      </div>
    </SlideOutPanel>
  );
}

const mono: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12.5,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};
const gutter: React.CSSProperties = {
  userSelect: 'none', color: 'var(--text-muted)', textAlign: 'right',
  padding: '1px 8px', minWidth: 38, borderRight: '1px solid var(--border-subtle)',
};
const labelCol: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const labelText: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' };

function UnifiedDiff({ rows }: { rows: DiffRow[] }) {
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%', ...mono }}>
      <tbody>
        {rows.map((r, i) => {
          const bg = r.op === 'add' ? ADD_BG : r.op === 'remove' ? DEL_BG : 'transparent';
          const sign = r.op === 'add' ? '+' : r.op === 'remove' ? '−' : ' ';
          return (
            <tr key={i} style={{ background: bg }}>
              <td style={gutter}>{r.oldLine ?? ''}</td>
              <td style={gutter}>{r.newLine ?? ''}</td>
              <td style={{ padding: '1px 4px 1px 8px', color: 'var(--text-muted)' }}>{sign}</td>
              <td style={{ padding: '1px 10px 1px 0', color: 'var(--text-primary)', width: '100%' }}>{r.text || ' '}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SplitDiff({ rows }: { rows: DiffRow[] }) {
  const pairs = useMemo(() => sideBySide(rows), [rows]);
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed', ...mono }}>
      <tbody>
        {pairs.map((p, i) => (
          <tr key={i}>
            <td style={gutter}>{p.left?.line ?? ''}</td>
            <td style={{ padding: '1px 10px', width: '50%', background: p.changed && p.left ? DEL_BG : 'transparent', color: 'var(--text-primary)', borderRight: '1px solid var(--border-subtle)' }}>{p.left?.text || ' '}</td>
            <td style={gutter}>{p.right?.line ?? ''}</td>
            <td style={{ padding: '1px 10px', width: '50%', background: p.changed && p.right ? ADD_BG : 'transparent', color: 'var(--text-primary)' }}>{p.right?.text || ' '}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
