'use client';

/**
 * BenchmarkPanel — on-device benchmarking for the LLM Studio.
 *
 * Trains a small EvermindLM on the supplied corpus, holds out a slice it never
 * trains on, and scores it on the standard language-model yardsticks
 * (perplexity, bits/token, top-1/top-k next-token accuracy, throughput) plus a
 * generation sample. Everything runs in the browser via the engine — no WebGPU,
 * no network. Per the insights-everywhere standard it doesn't just show numbers:
 * it interprets them against the random baseline and nudges the next action.
 *
 * Self-gating per the DRY rule: the panel owns its own input/loading/error/empty
 * states; the host only mounts it.
 */

import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BarChart, type BarDatum } from '@/components/charts/BarChart';
import { runEvermindBenchmark, type EvermindBenchmarkResult } from '@/lib/evermind-benchmark';

interface BenchmarkPanelProps {
  /** Optional initial corpus (e.g. text pulled from a project dataset). */
  initialCorpus?: string;
}

const SAMPLE_CORPUS =
  'BuilderForce orchestrates many agents through a planning loop. ' +
  'The memory layer stores facts as embeddings and recalls them on demand. ' +
  'Deployment runs on Cloudflare Workers and Durable Objects. ' +
  'Tools are gated by a capability registry. ' +
  'Agents recall facts and act on them before generating a response. ' +
  'The planning loop retrieves context, reasons over it, and then writes back what it learned.';

type Verdict = 'strong' | 'good' | 'weak';

/** Interpret perplexity against the random baseline (≈ vocab size). */
function verdictFor(result: EvermindBenchmarkResult): Verdict {
  const ratio = result.vocabSize > 0 ? result.perplexity / result.vocabSize : 1;
  if (ratio < 0.25) return 'strong';
  if (ratio < 0.6) return 'good';
  return 'weak';
}

/** True when training barely moved the loss — the actionable "underfit" signal. */
function underfit(result: EvermindBenchmarkResult): boolean {
  return result.finalTrainLoss >= result.initialTrainLoss - 0.05;
}

export function BenchmarkPanel({ initialCorpus }: BenchmarkPanelProps) {
  const t = useTranslations('benchmark');
  const [corpus, setCorpus] = useState((initialCorpus ?? '').trim() || SAMPLE_CORPUS);
  const [epochs, setEpochs] = useState(25);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EvermindBenchmarkResult | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const r = await runEvermindBenchmark(corpus, { epochs });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'));
    } finally {
      setRunning(false);
    }
  }, [corpus, epochs, t]);

  const accuracyBars: BarDatum[] = useMemo(() => {
    if (!result) return [];
    return [
      { key: 'top1', label: t('metric.top1'), value: result.top1Accuracy * 100, color: 'var(--coral-bright, #4d9eff)' },
      { key: 'topk', label: t('metric.topK', { k: result.topK }), value: result.topKAccuracy * 100, color: '#22c55e' },
    ];
  }, [result, t]);

  const verdict = result ? verdictFor(result) : null;
  const showNudge = result ? verdict === 'weak' || underfit(result) : false;

  const tile = (label: string, value: string, hint?: string) => (
    <div
      style={{
        background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
        borderRadius: 10, padding: '10px 12px', minWidth: 0,
      }}
    >
      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.15rem', marginTop: 2 }}>
        {value}
      </div>
      {hint && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.5, margin: 0 }}>
        {t('subtitle')}
      </p>

      {/* Corpus input */}
      <div>
        <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: 4 }}>
          {t('corpusLabel')}
        </label>
        <textarea
          value={corpus}
          onChange={(e) => setCorpus(e.target.value)}
          placeholder={t('corpusPlaceholder')}
          rows={5}
          spellCheck={false}
          style={{
            width: '100%', resize: 'vertical', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.76rem',
            lineHeight: 1.5, background: 'var(--bg-deep)', color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '8px 10px',
          }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: 4 }}>
            {t('epochsLabel')}
          </label>
          <input
            type="number"
            min={5}
            max={100}
            value={epochs}
            onChange={(e) => setEpochs(Math.max(5, Math.min(100, parseInt(e.target.value, 10) || 25)))}
            style={{
              width: 88, background: 'var(--bg-deep)', color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '6px 10px', fontSize: '0.8rem',
            }}
          />
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={running || corpus.trim().length === 0}
          style={{
            fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.82rem',
            background: running ? 'var(--bg-elevated)' : 'var(--coral-bright, #4d9eff)',
            color: running ? 'var(--text-muted)' : '#fff',
            border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '8px 16px',
            cursor: running || corpus.trim().length === 0 ? 'default' : 'pointer', opacity: corpus.trim().length === 0 ? 0.6 : 1,
          }}
        >
          {running ? `⏳ ${t('running')}` : `📊 ${t('run')}`}
        </button>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t('onDeviceNote')}</span>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            background: 'var(--warning-bg, rgba(239,68,68,0.12))', border: '1px solid #ef4444', color: '#fca5a5',
            borderRadius: 8, padding: '8px 12px', fontSize: '0.78rem',
          }}
        >
          ⚠ {error}
        </div>
      )}

      {!result && !error && !running && (
        <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{t('emptyHint')}</div>
      )}

      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Held-out provenance */}
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            {t('heldOutNote', { train: result.trainSequences, evalSeq: result.evalSequences, tokens: result.tokens })}
          </div>

          {/* Metric tiles */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
            {tile(t('metric.perplexity'), result.perplexity.toFixed(2), t('metric.lowerBetter'))}
            {tile(t('metric.bitsPerToken'), result.bitsPerToken.toFixed(2), t('metric.lowerBetter'))}
            {tile(t('metric.throughput'), Math.round(result.tokensPerSecond ?? 0).toLocaleString(), t('unit.tokPerSec'))}
            {tile(t('metric.vocab'), result.vocabSize.toLocaleString())}
          </div>

          {/* Accuracy bars */}
          <div
            style={{
              background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '12px 14px',
            }}
          >
            <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginBottom: 10, fontWeight: 600 }}>
              {t('accuracyTitle')}
            </div>
            <BarChart
              data={accuracyBars}
              formatValue={(v) => `${v.toFixed(0)}%`}
              labelWidth={120}
              ariaLabel={t('accuracyTitle')}
            />
          </div>

          {/* Loss drop */}
          <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
            {t('lossDrop', {
              from: result.initialTrainLoss.toFixed(3),
              to: result.finalTrainLoss.toFixed(3),
              delta: (result.initialTrainLoss - result.finalTrainLoss).toFixed(3),
            })}
          </div>

          {/* Verdict + nudge (insights-everywhere) */}
          {verdict && (
            <div
              style={{
                background: verdict === 'strong' ? 'rgba(34,197,94,0.12)' : verdict === 'good' ? 'rgba(77,158,255,0.12)' : 'var(--warning-bg, rgba(245,158,11,0.12))',
                border: `1px solid ${verdict === 'strong' ? '#22c55e' : verdict === 'good' ? 'var(--coral-bright, #4d9eff)' : '#f59e0b'}`,
                borderRadius: 10, padding: '10px 14px',
              }}
            >
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {verdict === 'strong' ? '🟢 ' : verdict === 'good' ? '🔵 ' : '🟡 '}
                {t(`verdict.${verdict}`)}
              </div>
              {showNudge && (
                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                  💡 {underfit(result) ? t('nudge.underfit') : t('nudge.weak')}
                </div>
              )}
            </div>
          )}

          {/* Generation sample */}
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: 4 }}>{t('sampleLabel')}</div>
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: '0.76rem', color: 'var(--text-primary)',
                background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '8px 10px',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}
            >
              {result.sample.trim() || t('sampleEmpty')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
