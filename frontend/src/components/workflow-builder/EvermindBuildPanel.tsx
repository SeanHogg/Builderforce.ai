'use client';

/**
 * EvermindBuildPanel — runs a visually-authored Evermind BUILD pipeline IN-BROWSER
 * via the engine (`lib/evermindBuild.ts`), streams the execution-output timeline,
 * and lets the user seed the bound project's Evermind (or download) the produced
 * `.evermind` artifact. Self-gating: owns its own run/timeline/seed states; the
 * host (WorkflowBuilder) only decides when to open it and passes the live graph.
 */

import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { usePermission } from '@/lib/rbac';
import type { WorkflowDefinitionGraph } from '@/lib/builderforceApi';
import {
  compileBuildGraph,
  runBuildWorkflow,
  hasBuildNodes,
  evermindArtifactToBase64,
  type StackStepResult,
  type StackDiagnosticResult,
} from '@/lib/evermindBuild';
import { seedProjectEvermindFromArtifact } from '@/lib/projectEvermindApi';
import { buildSparkline } from '@/lib/sparkline';

interface Props {
  open: boolean;
  onClose: () => void;
  /** The live builder graph (nodes + edges). Compiled to an engine WorkflowConfig. */
  graph: WorkflowDefinitionGraph;
  workflowName: string;
  /** Project the workflow is bound to, or null (tenant-wide) — seeding needs one. */
  projectId: number | null;
}

type StatusTone = { fg: string; bg: string; icon: string };
const TONE: Record<string, StatusTone> = {
  pass: { fg: 'var(--success, #22c55e)', bg: 'rgba(34,197,94,0.12)', icon: '✓' },
  fail: { fg: 'var(--error, #ef4444)', bg: 'rgba(239,68,68,0.12)', icon: '✕' },
  skip: { fg: 'var(--text-muted)', bg: 'var(--bg-elevated)', icon: '–' },
};

export function EvermindBuildPanel({ open, onClose, graph, workflowName, projectId }: Props) {
  const t = useTranslations('evermindBuild');
  const { allowed: canManage } = usePermission('project.manageEvermind');

  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<StackStepResult[]>([]);
  const [result, setResult] = useState<StackDiagnosticResult | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seededVersion, setSeededVersion] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const compiled = useMemo(() => compileBuildGraph(graph, workflowName), [graph, workflowName]);
  const stepCount = compiled.config?.steps.length ?? 0;
  const hasBuild = hasBuildNodes(graph.nodes);

  const run = useCallback(async () => {
    if (!compiled.config) return;
    setRunning(true);
    setRows([]);
    setResult(null);
    setSeededVersion(null);
    setError(null);
    try {
      const res = await runBuildWorkflow(compiled.config, (r) => setRows((prev) => [...prev, r]));
      setResult(res);
      setRows(res.steps);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errUnknown'));
    } finally {
      setRunning(false);
    }
  }, [compiled.config, t]);

  // The produced artifact + its tokenizer (seed needs both).
  const artifactB64 = useMemo(
    () => (result ? evermindArtifactToBase64(result.artifacts.evermind) : null),
    [result],
  );
  const tokenizer = result?.artifacts.tokenizer as { vocab: Record<string, number>; merges: string[] } | undefined;
  const canSeed = !!artifactB64 && !!tokenizer && projectId != null && canManage;

  const seed = useCallback(async () => {
    if (!artifactB64 || !tokenizer || projectId == null) return;
    setSeeding(true);
    setError(null);
    try {
      const r = await seedProjectEvermindFromArtifact(projectId, {
        model: artifactB64,
        tokenizer,
        name: workflowName,
      });
      setSeededVersion(r.version);
    } catch (e) {
      setError(t('seedFailed', { error: e instanceof Error ? e.message : t('errUnknown') }));
    } finally {
      setSeeding(false);
    }
  }, [artifactB64, tokenizer, projectId, workflowName, t]);

  const download = useCallback(() => {
    const raw = result?.artifacts.evermind;
    const buf: ArrayBuffer | null =
      raw instanceof ArrayBuffer ? raw : raw instanceof Uint8Array ? (raw.buffer as ArrayBuffer) : null;
    if (!buf) return;
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${workflowName.replace(/[^a-z0-9-_]+/gi, '_') || 'model'}.evermind`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result, workflowName]);

  const firstFailLabel = result?.firstFailure?.label;

  return (
    <SlideOutPanel open={open} onClose={onClose} title={t('title')} width="min(560px, 96vw)">
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>{t('subtitle')}</p>

        {!hasBuild ? (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '12px 14px' }}>
            {t('noBuildNodes')}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{t('stepsReady', { count: stepCount })}</span>
              <button
                type="button"
                onClick={() => void run()}
                disabled={running || stepCount === 0}
                style={{
                  padding: '8px 16px', fontSize: 13, fontWeight: 700,
                  background: running ? 'var(--bg-elevated)' : 'var(--coral-bright, #f4726e)',
                  color: running ? 'var(--text-muted)' : '#fff',
                  border: '1px solid var(--border-subtle)', borderRadius: 8,
                  cursor: running || stepCount === 0 ? 'default' : 'pointer', opacity: running || stepCount === 0 ? 0.7 : 1,
                }}
              >
                {running ? `⏳ ${t('running')}` : result ? `▶ ${t('rerun')}` : `▶ ${t('run')}`}
              </button>
            </div>

            {/* Execution timeline */}
            {rows.length > 0 && (
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                  {t('timelineTitle')}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {rows.map((r) => {
                    const tone = TONE[r.status] ?? TONE.skip;
                    return (
                      <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '7px 10px' }}>
                        <span aria-hidden style={{ flexShrink: 0, width: 18, height: 18, borderRadius: 5, background: tone.bg, color: tone.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
                          {tone.icon}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, justifyContent: 'space-between' }}>
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>
                              <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)', fontSize: 10.5, marginRight: 6 }}>{r.layer}</span>
                              {r.label}
                            </span>
                            <span style={{ fontSize: 10.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{t('durationMs', { ms: r.ms })}</span>
                          </div>
                          {r.detail && <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2, wordBreak: 'break-word' }}>{r.detail}</div>}
                          {r.error && <div style={{ fontSize: 11.5, color: 'var(--error-text, #fca5a5)', marginTop: 2, wordBreak: 'break-word' }}>{r.error}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Outcome banner */}
            {result && (
              <div
                role="status"
                style={{
                  fontSize: 12.5, borderRadius: 10, padding: '10px 12px',
                  background: result.ok ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                  border: `1px solid ${result.ok ? 'var(--success, #22c55e)' : 'var(--error, #ef4444)'}`,
                  color: 'var(--text-primary)',
                }}
              >
                {result.ok
                  ? `🟢 ${t('okAll', { count: result.steps.length })}`
                  : `🔴 ${t('failed', { label: firstFailLabel ?? '' })}`}
              </div>
            )}

            {/* Structured training metrics the pipeline computed (loss curve, perplexity,
                top-1, pass@1, dataset quality) — surfaced from runStackDiagnostic().metrics
                instead of being buried in per-step detail strings. */}
            {result && <BuildMetrics metrics={result.metrics} />}

            {/* Artifact + seed / download */}
            {result && (
              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {t('artifactTitle')}
                </div>
                {artifactB64 ? (
                  <>
                    <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>📦 {t('artifactReady')}</div>
                    {seededVersion != null && (
                      <div style={{ fontSize: 12.5, color: 'var(--success, #22c55e)' }}>✓ {t('seeded', { version: seededVersion })}</div>
                    )}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => void seed()}
                        disabled={!canSeed || seeding}
                        title={projectId == null ? t('seedNeedsProject') : undefined}
                        style={{
                          padding: '7px 14px', fontSize: 12.5, fontWeight: 600,
                          background: 'var(--coral-bright, #f4726e)', color: '#fff', border: 'none', borderRadius: 8,
                          cursor: !canSeed || seeding ? 'not-allowed' : 'pointer', opacity: !canSeed || seeding ? 0.55 : 1,
                        }}
                      >
                        {seeding ? t('seeding') : t('seed')}
                      </button>
                      <button
                        type="button"
                        onClick={download}
                        style={{ padding: '7px 14px', fontSize: 12.5, fontWeight: 600, background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: 'pointer' }}
                      >
                        ⬇ {t('download')}
                      </button>
                    </div>
                    {projectId == null && <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{t('seedNeedsProject')}</div>}
                  </>
                ) : (
                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{t('artifactNone')}</div>
                )}
              </div>
            )}
          </>
        )}

        {error && (
          <div role="alert" style={{ fontSize: 12.5, color: 'var(--error-text, #fca5a5)', background: 'var(--error-bg, rgba(239,68,68,0.12))', border: '1px solid var(--error-border, #ef4444)', borderRadius: 8, padding: '8px 12px' }}>
            ⚠ {error}
          </div>
        )}
      </div>
    </SlideOutPanel>
  );
}

/* ── Build metrics ─────────────────────────────────────────────────────────────
   The real numbers the pipeline computed, read from the engine's curated
   `metrics` (loss curve, benchmark, dataset quality, pass@1). `metrics` is an
   untyped bag, so each field is narrowed defensively and only rendered when present. */

const mNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const mNumArray = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)) : [];
const mRec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function BuildMetrics({ metrics }: { metrics: Record<string, unknown> }) {
  const t = useTranslations('evermindBuild');
  const loss = mNumArray(metrics.trainingHistory);
  const videoLoss = mNumArray(metrics.videoTrainingHistory);
  const curve = loss.length >= 2 ? loss : videoLoss;
  const bench = mRec(metrics.benchmark);
  const ds = mRec(metrics.datasetMetrics);
  const code = mRec(metrics.codeBenchmark);
  const converged = metrics.converged === true;
  const videoMSE = mNum(metrics.videoReconMSE);

  const tiles: Array<{ label: string; value: string }> = [];
  const ppl = mNum(bench.perplexity); if (ppl != null) tiles.push({ label: t('mPerplexity'), value: ppl.toFixed(2) });
  const bpt = mNum(bench.bitsPerToken); if (bpt != null) tiles.push({ label: t('mBits'), value: bpt.toFixed(2) });
  const top1 = mNum(bench.top1Accuracy); if (top1 != null) tiles.push({ label: t('mTop1'), value: `${(top1 * 100).toFixed(0)}%` });
  const topk = mNum(bench.topKAccuracy); if (topk != null) tiles.push({ label: t('mTopK', { k: mNum(bench.topK) ?? 5 }), value: `${(topk * 100).toFixed(0)}%` });
  const pass1 = mNum(code.pass1); if (pass1 != null) tiles.push({ label: t('mPass1'), value: `${(pass1 * 100).toFixed(0)}%` });
  const words = mNum(ds.words); if (words != null) tiles.push({ label: t('mWords'), value: words.toLocaleString() });
  const seqs = mNum(ds.sequences); if (seqs != null) tiles.push({ label: t('mSequences'), value: seqs.toLocaleString() });
  const dup = mNum(ds.duplicateRatio); if (dup != null) tiles.push({ label: t('mDuplicate'), value: `${(dup * 100).toFixed(0)}%` });
  if (videoMSE != null) tiles.push({ label: t('mVideoMse'), value: videoMSE.toFixed(4) });

  const spark = buildSparkline(curve, { w: 240, h: 44 });
  const finalLoss = curve.length ? curve[curve.length - 1]! : null;
  const lastDot = spark?.dots.at(-1);

  if (!spark && tiles.length === 0 && !converged) return null;

  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t('metricsTitle')}</span>
        {converged && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--success, #22c55e)' }}>✓ {t('mConverged')}</span>}
      </div>

      {spark && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>
            <span>{t('mLossCurve')}</span>
            {finalLoss != null && <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)' }}>{t('mFinalLoss', { loss: finalLoss.toFixed(3) })}</span>}
          </div>
          <svg viewBox={`0 0 ${spark.w} ${spark.h}`} preserveAspectRatio="none" role="img" aria-label={t('mLossAria', { count: curve.length })} style={{ width: '100%', height: 44, display: 'block' }}>
            <polyline points={spark.points} fill="none" stroke="var(--coral-bright, #f4726e)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            {lastDot && <circle cx={lastDot.x} cy={lastDot.y} r={2.4} fill="var(--coral-bright, #f4726e)" />}
          </svg>
        </div>
      )}

      {tiles.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(84px, 1fr))', gap: 8 }}>
          {tiles.map((tile) => (
            <div key={tile.label} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '7px 10px' }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>{tile.label}</div>
              <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>{tile.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
