import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { RoleGate } from '@/components/RoleGate';
import { Select } from '@/components/Select';
import { GateReasonList } from './GateReasonList';
import { faultMessage } from '@/lib/apiClient';
import {
  acceptPrRisk, getPrGate, listOpenPullRequests, listScannableRepos, runBranchScan,
  type BranchScanResult, type OpenPullRequest, type PrGateState, type ScannableRepo,
} from '@/lib/governanceDevsecopsApi';

/**
 * "Run scan" for the vulnerability-scans tracker (PRD 08 §10): scan a connected repository's
 * branch now, with the same use case that scans every agent PR. Only this segment's connected
 * repos are offered. A scan that could not run is shown as skipped with its reason in the scan
 * list - never as a clean result.
 */
export interface RunScanPanelProps {
  open: boolean;
  onClose: () => void;
  /** Called after a scan ran, so the scans list behind the panel refreshes. */
  onDone: () => void;
}

const GOVERNANCE_WRITE_CAP = 'policies.manage' as const;

export function RunScanPanel({ open, onClose, onDone }: RunScanPanelProps) {
  const t = useTranslations('governance.runScan');
  const [repos, setRepos] = useState<ScannableRepo[] | null>(null);
  const [repoId, setRepoId] = useState('');
  const [ref, setRef] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BranchScanResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setError(null);
    listScannableRepos()
      .then((r) => { setRepos(r); setRepoId((cur) => cur || r[0]?.id || ''); })
      .catch(() => setError(t('loadReposError')));
  }, [open, t]);

  const run = async () => {
    if (!repoId) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      setResult(await runBranchScan(repoId, ref));
      onDone();
    } catch (e) {
      setError(faultMessage(e, t('error')) ?? t('error'));
    } finally {
      setRunning(false);
    }
  };

  return (
    <SlideOutPanel open={open} onClose={onClose} title={t('title')} crumb={t('crumb')} width="wide" widthStorageKey="run-scan">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('intro')}</div>

        {repos && repos.length === 0 && <div style={{ color: 'var(--text-secondary)' }}>{t('noRepos')}</div>}

        {repos && repos.length > 0 && (
          <>
            <label style={field}>
              <span style={label}>{t('repo')}</span>
              <Select value={repoId} onChange={(e) => setRepoId(e.target.value)} style={input} aria-label={t('repo')}>
                <option value="" disabled>{t('pickRepo')}</option>
                {repos.map((r) => <option key={r.id} value={r.id}>{`${r.owner}/${r.repo}`}</option>)}
              </Select>
            </label>
            <label style={field}>
              <span style={label}>{t('ref')}</span>
              <input value={ref} onChange={(e) => setRef(e.target.value)} style={input} aria-label={t('ref')} />
              <span style={hint}>{t('refHint')}</span>
            </label>
            <div>
              <RoleGate capability={GOVERNANCE_WRITE_CAP}>
                <button onClick={() => void run()} disabled={running || !repoId} style={{ ...btn, opacity: running ? 0.6 : 1 }}>
                  {running ? t('running') : t('run')}
                </button>
              </RoleGate>
            </div>
          </>
        )}

        {error && <div role="alert" style={{ ...bar, background: 'var(--danger-bg)', color: 'var(--danger-text)', borderColor: 'var(--danger-border)' }}>{error}</div>}

        {result && (
          <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontWeight: 600 }}>{t('result', { branch: result.branch, files: result.filesRead })}</div>
            {result.truncated && <div style={hint}>{t('truncated')}</div>}
            {result.unreadable && <div style={hint}>{result.unreadable}</div>}
            {result.incidentsOpened > 0 && <div style={{ color: 'var(--danger-text)' }}>{t('incidents', { n: result.incidentsOpened })}</div>}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>{t('colType')}</th>
                    <th style={th}>{t('colStatus')}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.scans.map((s) => (
                    <tr key={s.scanId}>
                      <td style={td}>{s.scanType}</td>
                      <td style={td}>{t(`status.${s.status}`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <AcceptRiskSection open={open} />
      </div>
    </SlideOutPanel>
  );
}

/**
 * Accept the security risk of ONE open pull request at its CURRENT head commit, with a written reason,
 * so a PR the scanners cannot fully cover is not held by the merge gate forever. Manager-only on the
 * server; audited; honoured for that commit only - a later push needs a new decision.
 */
function AcceptRiskSection({ open }: { open: boolean }) {
  const t = useTranslations('governance.runScan');
  const [prs, setPrs] = useState<OpenPullRequest[] | null>(null);
  const [prId, setPrId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gate, setGate] = useState<PrGateState | null>(null);

  // What the manager is shown for the chosen PR: its head commit and why the gate holds it. The commit
  // shown is the commit sent back as `expectedHeadSha`.
  useEffect(() => {
    setGate(null);
    if (!open || !prId) return;
    getPrGate(prId).then(setGate).catch(() => setError(t('loadPrsError')));
  }, [open, prId, t]);

  useEffect(() => {
    if (!open) return;
    setNotice(null);
    setError(null);
    listOpenPullRequests().then((r) => { setPrs(r); setPrId((cur) => cur || r[0]?.id || ''); }).catch(() => setError(t('loadPrsError')));
  }, [open, t]);

  const accept = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (!gate?.headSha) return;
      const out = await acceptPrRisk(prId, reason, gate.headSha);
      setNotice(t(out.alreadyAccepted ? 'acceptedAlready' : 'accepted', { sha: out.headSha.slice(0, 12) }));
      setReason('');
    } catch (e) {
      setError(faultMessage(e, t('acceptError')) ?? t('acceptError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="accept-risk-title" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div id="accept-risk-title" style={{ fontWeight: 600 }}>{t('acceptTitle')}</div>
      <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('acceptIntro')}</div>
      {prs && prs.length === 0 && <div style={{ color: 'var(--text-secondary)' }}>{t('noPrs')}</div>}
      {prs && prs.length > 0 && (
        <>
          <label style={field}>
            <span style={label}>{t('pickPr')}</span>
            <Select value={prId} onChange={(e) => setPrId(e.target.value)} style={input} aria-label={t('pickPr')}>
              {prs.map((p) => <option key={p.id} value={p.id}>{`#${p.number ?? '?'} ${p.branchName ?? ''}`.trim()}</option>)}
            </Select>
          </label>
          {gate && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={hint}>{gate.headSha ? t('headCommit', { sha: gate.headSha.slice(0, 12) }) : t('headUnreadable')}</div>
              {gate.reasons.length > 0 && (
                <>
                  <div style={hint}>{t('heldBecause')}</div>
                  <GateReasonList reasons={gate.reasons} style={{ margin: '0 0 0 18px', fontSize: 'var(--font-size-small)' }} />
                </>
              )}
              {gate.allowed && <div style={hint}>{t('notHeld')}</div>}
            </div>
          )}
          <label style={field}>
            <span style={label}>{t('reason')}</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} style={{ ...input, maxWidth: 'none', fontFamily: 'inherit' }} aria-label={t('reason')} />
            <span style={hint}>{t('reasonHint')}</span>
          </label>
          <div>
            <RoleGate capability={GOVERNANCE_WRITE_CAP}>
              <button onClick={() => void accept()} disabled={busy || !prId || !gate?.headSha || reason.trim().length < 10} style={{ ...btn, opacity: busy ? 0.6 : 1 }}>
                {busy ? t('accepting') : t('accept')}
              </button>
            </RoleGate>
          </div>
        </>
      )}
      {notice && <div role="status" style={{ ...bar, background: 'var(--success-bg)', color: 'var(--success-text)', borderColor: 'var(--success-border)' }}>{notice}</div>}
      {error && <div role="alert" style={{ ...bar, background: 'var(--danger-bg)', color: 'var(--danger-text)', borderColor: 'var(--danger-border)' }}>{error}</div>}
    </section>
  );
}

const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const label: React.CSSProperties = { fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' };
const hint: React.CSSProperties = { fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' };
const input: React.CSSProperties = { fontSize: 'var(--font-size-small)', padding: '5px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)', width: '100%', maxWidth: 420 };
const btn: React.CSSProperties = { padding: '6px 14px', fontSize: 'var(--font-size-small)', fontWeight: 600, background: 'var(--accent)', color: 'var(--text-on-accent)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' };
const bar: React.CSSProperties = { padding: '8px 12px', border: '1px solid', borderRadius: 'var(--radius-sm)' };
const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontWeight: 600 };
const td: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)' };
