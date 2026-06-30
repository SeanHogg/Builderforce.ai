'use client';

/**
 * BenchmarkPanel — benchmarking for the LLM Studio.
 *
 * Two modes:
 *  • "Train fresh" — trains a small EvermindLM on the supplied corpus and scores
 *    it on a held-out split, entirely on-device (no WebGPU, no network).
 *  • "Score a trained model" — scores the user's ACTUAL published `.evermind`
 *    model against held-out text on the server, tokenized with the model's own
 *    persisted tokenizer (so the score reflects the real artifact, not a
 *    throwaway). The heavy artifact stays server-side; the result is cached.
 *
 * Per the insights-everywhere standard it interprets the numbers against the
 * random baseline and nudges the next action. Self-gating per the DRY rule: the
 * panel owns its own mode/input/loading/error/empty states; the host only mounts it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BarChart, type BarDatum } from '@/components/charts/BarChart';
import { runEvermindBenchmark } from '@/lib/evermind-benchmark';
import {
  listEvermindModels,
  benchmarkPublishedModel,
  type PublishedEvermindModel,
} from '@/lib/studioModelsApi';

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

type Mode = 'train' | 'score';
type Verdict = 'strong' | 'good' | 'weak';

/**
 * Unified scorecard rendered by both modes. Training-only fields are optional —
 * the "score a published model" path doesn't train, so it omits them and the UI
 * guards on their presence.
 */
interface Scorecard {
  perplexity: number;
  bitsPerToken: number;
  top1Accuracy: number;
  topKAccuracy: number;
  topK: number;
  tokensPerSecond?: number;
  vocabSize: number;
  tokens: number;
  sample: string;
  // Train-mode only:
  trainSequences?: number;
  evalSequences?: number;
  initialTrainLoss?: number;
  finalTrainLoss?: number;
}

/** Interpret perplexity against the random baseline (≈ vocab size). */
function verdictFor(result: Scorecard): Verdict {
  const ratio = result.vocabSize > 0 ? result.perplexity / result.vocabSize : 1;
  if (ratio < 0.25) return 'strong';
  if (ratio < 0.6) return 'good';
  return 'weak';
}

/** True when training barely moved the loss — the actionable "underfit" signal (train mode only). */
function underfit(result: Scorecard): boolean {
  if (result.initialTrainLoss == null || result.finalTrainLoss == null) return false;
  return result.finalTrainLoss >= result.initialTrainLoss - 0.05;
}

export function BenchmarkPanel({ initialCorpus }: BenchmarkPanelProps) {
  const t = useTranslations('benchmark');
  const [mode, setMode] = useState<Mode>('train');
  const [corpus, setCorpus] = useState((initialCorpus ?? '').trim() || SAMPLE_CORPUS);
  const [epochs, setEpochs] = useState(25);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Scorecard | null>(null);

  // Published models (lazy-loaded once, used by "score" mode).
  const [models, setModels] = useState<PublishedEvermindModel[] | null>(null);
  const [selectedSlug, setSelectedSlug] = useState('');

  useEffect(() => {
    if (mode !== 'score' || models !== null) return;
    let cancelled = false;
    void listEvermindModels()
      .then((list) => {
        if (cancelled) return;
        setModels(list);
        if (list.length > 0) setSelectedSlug((s) => s || list[0].slug);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, models]);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      if (mode === 'score') {
        const r = await benchmarkPublishedModel(selectedSlug, corpus, 5);
        setResult(r);
      } else {
        const r = await runEvermindBenchmark(corpus, { epochs });
        setResult(r as Scorecard);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'));
    } finally {
      setRunning(false);
    }
  }, [mode, selectedSlug, corpus, epochs, t]);

  const accuracyBars: BarDatum[] = useMemo(() => {
    if (!result) return [];
    return [
      { key: 'top1', label: t('metric.top1'), value: result.top1Accuracy * 100, color: 'var(--coral-bright, #4d9eff)' },
      { key: 'topk', label: t('metric.topK', { k: result.topK }), value: result.topKAccuracy * 100, color: '#22c55e' },
    ];
  }, [result, t]);

  const verdict = result ? verdictFor(result) : null;
  const hasTraining = result?.initialTrainLoss != null && result?.finalTrainLoss != null;
  const showNudge = result ? verdict === 'weak' || underfit(result) : false;

  const noModels = mode === 'score' && models !== null && models.length === 0;
  const runDisabled =
    running ||
    corpus.trim().length === 0 ||
    (mode === 'score' && (!selectedSlug || noModels));

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

  const modeButton = (m: Mode, label: string) => (
    <button
      type="button"
      onClick={() => {
        setMode(m);
        setResult(null);
        setError(null);
      }}
      aria-pressed={mode === m}
      style={{
        fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.76rem',
        background: mode === m ? 'var(--coral-bright, #4d9eff)' : 'var(--bg-elevated)',
        color: mode === m ? '#fff' : 'var(--text-secondary)',
        border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '6px 12px',
        cursor: mode === m ? 'default' : 'pointer',
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {modeButton('train', t('mode.train'))}
        {modeButton('score', t('mode.score'))}
      </div>

      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.5, margin: 0 }}>
        {mode === 'score' ? t('subtitleScore') : t('subtitle')}
      </p>

      {/* Score mode: published-model picker */}
      {mode === 'score' && (
        <div>
          <label
            htmlFor="evermind-model-picker"
            style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: 4 }}
          >
            {t('modelLabel')}
          </label>
          {noModels ? (
            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{t('noModels')}</div>
          ) : (
            <select
              id="evermind-model-picker"
              value={selectedSlug}
              onChange={(e) => setSelectedSlug(e.target.value)}
              disabled={models === null}
              style={{
                width: '100%', background: 'var(--bg-deep)', color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '8px 10px', fontSize: '0.8rem',
              }}
            >
              {models === null && <option>{t('running')}</option>}
              {models?.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Corpus input */}
      <div>
        <label
          htmlFor="evermind-corpus"
          style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: 4 }}
        >
          {mode === 'score' ? t('corpusLabelScore') : t('corpusLabel')}
        </label>
        <textarea
          id="evermind-corpus"
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
        {mode === 'train' && (
          <div>
            <label
              htmlFor="evermind-epochs"
              style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: 4 }}
            >
              {t('epochsLabel')}
            </label>
            <input
              id="evermind-epochs"
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
        )}
        <button
          type="button"
          onClick={() => void run()}
          disabled={runDisabled}
          style={{
            fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.82rem',
            background: running ? 'var(--bg-elevated)' : 'var(--coral-bright, #4d9eff)',
            color: running ? 'var(--text-muted)' : '#fff',
            border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '8px 16px',
            cursor: runDisabled ? 'default' : 'pointer', opacity: runDisabled ? 0.6 : 1,
          }}
        >
          {running ? `⏳ ${t('running')}` : `📊 ${mode === 'score' ? t('runScore') : t('run')}`}
        </button>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          {mode === 'score' ? t('serverNote') : t('onDeviceNote')}
        </span>
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

      {!result && !error && !running && !noModels && (
        <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{t('emptyHint')}</div>
      )}

      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Provenance */}
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            {hasTraining
              ? t('heldOutNote', {
                  train: result.trainSequences ?? 0,
                  evalSeq: result.evalSequences ?? 0,
                  tokens: result.tokens,
                })
              : t('scoredNote', { tokens: result.tokens })}
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

          {/* Loss drop (train mode only) */}
          {hasTraining && (
            <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
              {t('lossDrop', {
                from: (result.initialTrainLoss ?? 0).toFixed(3),
                to: (result.finalTrainLoss ?? 0).toFixed(3),
                delta: ((result.initialTrainLoss ?? 0) - (result.finalTrainLoss ?? 0)).toFixed(3),
              })}
            </div>
          )}

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
                  💡 {underfit(result) ? t('nudge.underfit') : hasTraining ? t('nudge.weak') : t('nudge.weakScore')}
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
