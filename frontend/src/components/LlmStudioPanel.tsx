'use client';

/**
 * LlmStudioPanel — center workspace for the `llm` project modality.
 *
 * The `llm` modality is about *building + training* a custom model, not a chat
 * playground (chat already lives in the Brain on the left, which is modality-aware
 * and runs cloud inference today). This panel orients the user through the
 * build → train → publish pipeline and surfaces live project state, then hands
 * off to the existing Train / Publish right-panel tabs rather than re-implementing
 * them. It reads real data via the existing dataset/training APIs.
 *
 * Self-gating per the DRY rule: the panel owns its own loading/empty/error states;
 * the host (IDENew) only decides whether the `llm` modality is active.
 */

import { useCallback, useEffect, useState } from 'react';
import { listDatasets, listTrainingJobs } from '@/lib/api';
import type { Dataset, TrainingJob } from '@/lib/types';
import type { RightTab } from '@/lib/modality';

interface LlmStudioPanelProps {
  projectId: number | string;
  /** Switch the right-panel tab — used by the pipeline CTAs to jump to Train / Publish. */
  onGoToTab?: (tab: RightTab) => void;
}

export function LlmStudioPanel({ projectId, onGoToTab }: LlmStudioPanelProps) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ds, tj] = await Promise.all([
        listDatasets(projectId).catch(() => [] as Dataset[]),
        listTrainingJobs(projectId).catch(() => [] as TrainingJob[]),
      ]);
      setDatasets(Array.isArray(ds) ? ds : []);
      setJobs(Array.isArray(tj) ? tj : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load project state.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  // "Trained" = a job that produced a downloadable LoRA artifact in R2.
  const trainedCount = jobs.filter((j) => !!j.r2_artifact_key).length;

  const steps: Array<{
    n: number;
    icon: string;
    title: string;
    body: string;
    metric: string;
    cta?: { label: string; tab: RightTab };
  }> = [
    {
      n: 1,
      icon: '📝',
      title: 'Design your dataset',
      body: 'Use the Brain on the left to draft instruction/response pairs and reason about architecture. Datasets are stored per-project and feed training.',
      metric: `${datasets.length} dataset${datasets.length === 1 ? '' : 's'}`,
      cta: { label: 'Open Files', tab: 'files' },
    },
    {
      n: 2,
      icon: '🧠',
      title: 'Train a LoRA adapter',
      body: 'Fine-tune a base model in-browser via WebGPU. Each run produces a portable LoRA artifact you can evaluate and iterate on.',
      metric: `${jobs.length} run${jobs.length === 1 ? '' : 's'} · ${trainedCount} trained`,
      cta: { label: 'Open Train', tab: 'train' },
    },
    {
      n: 3,
      icon: '🚀',
      title: 'Publish to the Workforce',
      body: 'Bundle your trained adapter (optionally with Mamba memory) into an agent package and publish it to the Workforce Registry.',
      metric: trainedCount > 0 ? 'Ready to publish' : 'Train a model first',
      cta: { label: 'Open Publish', tab: 'publish' },
    },
  ];

  return (
    <div
      style={{
        height: '100%',
        overflow: 'auto',
        background: 'var(--bg-deep)',
        color: 'var(--text-primary)',
        padding: '24px 28px',
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: '1.6rem' }}>🧠</span>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.25rem', margin: 0 }}>
            Build a Custom Model
          </h1>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.5, marginTop: 0, marginBottom: 20 }}>
          Design data, fine-tune a LoRA adapter, and ship it as a hireable agent — all from the browser.
          Chat and prompt design happen in the Brain on the left; the steps below drive the build pipeline.
        </p>

        {error && (
          <div
            style={{
              background: 'rgba(239,68,68,0.12)', border: '1px solid #ef4444', color: '#fca5a5',
              borderRadius: 8, padding: '8px 12px', fontSize: '0.8rem', marginBottom: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            }}
          >
            <span>⚠ {error}</span>
            <button
              type="button"
              onClick={() => void load()}
              style={{
                background: 'transparent', color: '#fca5a5', border: '1px solid #ef4444',
                borderRadius: 6, padding: '2px 10px', fontSize: '0.75rem', cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {steps.map((step) => (
            <div
              key={step.n}
              style={{
                display: 'flex', gap: 14, alignItems: 'flex-start',
                background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
                borderRadius: 12, padding: '16px 18px',
              }}
            >
              <div
                style={{
                  flexShrink: 0, width: 38, height: 38, borderRadius: 10,
                  background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: '1.2rem',
                }}
              >
                {step.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.95rem' }}>
                    {step.n}. {step.title}
                  </span>
                  <span
                    style={{
                      fontSize: '0.7rem', fontWeight: 600, color: 'var(--coral-bright, #4d9eff)',
                      background: 'rgba(77,158,255,0.12)', borderRadius: 6, padding: '1px 8px',
                    }}
                  >
                    {loading ? '…' : step.metric}
                  </span>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.5, margin: '6px 0 10px' }}>
                  {step.body}
                </p>
                {step.cta && onGoToTab && (
                  <button
                    type="button"
                    onClick={() => onGoToTab(step.cta!.tab)}
                    style={{
                      fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '0.78rem',
                      background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)', borderRadius: 8,
                      padding: '5px 12px', cursor: 'pointer',
                    }}
                  >
                    {step.cta.label} →
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <p style={{ color: 'var(--text-muted)', fontSize: '0.72rem', lineHeight: 1.5, marginTop: 20 }}>
          ☁️ Cloud inference is active now. 💻 On-device (Local) and ⚡ Hybrid inference arrive with the
          in-browser model runtime — switch modes from the toolbar in the Brain.
        </p>
      </div>
    </div>
  );
}
