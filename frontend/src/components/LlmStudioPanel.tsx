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
import { useTranslations } from 'next-intl';
import { listDatasets, listTrainingJobs } from '@/lib/api';
import type { Dataset, FileEntry, TrainingJob } from '@/lib/types';
import { getFileName } from '@/lib/utils';
import type { RightTab } from '@/lib/modality';
import { BenchmarkPanel } from '@/components/BenchmarkPanel';
import { ModelExportPanel } from '@/components/ModelExportPanel';
import { ProjectEvermindPanel } from '@/components/ide/ProjectEvermindPanel';

interface LlmStudioPanelProps {
  projectId: number | string;
  /** Project files — used to surface dataset-like files (.json/.jsonl) the Brain wrote. */
  files?: FileEntry[];
  /** Switch the right-panel tab — used by the pipeline CTAs to jump to Train / Publish. */
  onGoToTab?: (tab: RightTab) => void;
  /** Open a project file in the center code view (e.g. inspect a dataset). */
  onOpenFile?: (path: string) => void;
}

/** A project file that looks like a training dataset the Brain or user produced. */
function isDatasetFile(path: string): boolean {
  return /\.(jsonl|json)$/i.test(path);
}

export function LlmStudioPanel({ projectId, files = [], onGoToTab, onOpenFile }: LlmStudioPanelProps) {
  const t = useTranslations('llmStudio');
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [benchmarkOpen, setBenchmarkOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

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
      setError(e instanceof Error ? e.message : t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => { void load(); }, [load]);

  // "Trained" = a job that produced a downloadable LoRA artifact in R2.
  const trainedCount = jobs.filter((j) => !!j.r2_artifact_key).length;

  // Dataset-like project files (what the Brain writes via "Create file"). These
  // live in the file store, separate from the dataset API, so surface both: the
  // count drives step 1 and the list lets the user open one in the code view.
  const datasetFiles = files.filter((f) => f.type === 'file' && isDatasetFile(f.path));
  // Total distinct datasets the user has, from either source.
  const datasetTotal = datasets.length + datasetFiles.length;

  const steps: Array<{
    n: number;
    icon: string;
    title: string;
    body: string;
    metric: string;
    cta?: { label: string; tab: RightTab };
    /** Special-cased step rendered with an inline panel instead of a tab CTA. */
    kind?: 'benchmark' | 'export';
  }> = [
    {
      n: 1,
      icon: '📝',
      title: t('step1.title'),
      body: t('step1.body'),
      metric: t('step1.metric', { count: datasetTotal }),
      cta: { label: t('step1.cta'), tab: 'files' },
    },
    {
      n: 2,
      icon: '🧠',
      title: t('step2.title'),
      body: t('step2.body'),
      metric: t('step2.metric', { runs: jobs.length, trained: trainedCount }),
      cta: { label: t('step2.cta'), tab: 'train' },
    },
    {
      n: 3,
      icon: '📊',
      title: t('step3.title'),
      body: t('step3.body'),
      metric: t('step3.metric'),
      kind: 'benchmark',
    },
    {
      n: 4,
      icon: '🚀',
      title: t('step4.title'),
      body: t('step4.body'),
      metric: trainedCount > 0 ? t('step4.metricReady') : t('step4.metricNeedTrain'),
      cta: { label: t('step4.cta'), tab: 'publish' },
    },
    {
      n: 5,
      icon: '📦',
      title: t('step5.title'),
      body: t('step5.body'),
      metric: t('step5.metric'),
      kind: 'export',
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
            {t('title')}
          </h1>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.5, marginTop: 0, marginBottom: 20 }}>
          {t('intro')}
        </p>

        {/* The project's Evermind — every project gets a default one on creation, so
            this always renders a real model to run/learn/edit. Self-gating (RBAC +
            its own loading/empty states), localized, theme-aware. */}
        <div style={{ marginBottom: 20 }}>
          <ProjectEvermindPanel projectId={Number(projectId)} />
        </div>

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
              {t('retry')}
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

                {/* Benchmark step: an inline, on-device scorecard rather than a
                    right-panel tab — the model is trained + scored right here. */}
                {step.kind === 'benchmark' && (
                  <div style={{ marginTop: 4 }}>
                    <button
                      type="button"
                      onClick={() => setBenchmarkOpen((v) => !v)}
                      aria-expanded={benchmarkOpen}
                      style={{
                        fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '0.78rem',
                        background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                        border: '1px solid var(--border-subtle)', borderRadius: 8,
                        padding: '5px 12px', cursor: 'pointer',
                      }}
                    >
                      {benchmarkOpen ? t('step3.close') : t('step3.open')}
                    </button>
                    {benchmarkOpen && (
                      <div style={{ marginTop: 12 }}>
                        <BenchmarkPanel />
                      </div>
                    )}
                  </div>
                )}

                {/* Export step: an inline panel that downloads the published
                    model as a portable artifact (HF repo / ONNX / safetensors / GGUF). */}
                {step.kind === 'export' && (
                  <div style={{ marginTop: 4 }}>
                    <button
                      type="button"
                      onClick={() => setExportOpen((v) => !v)}
                      aria-expanded={exportOpen}
                      style={{
                        fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '0.78rem',
                        background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                        border: '1px solid var(--border-subtle)', borderRadius: 8,
                        padding: '5px 12px', cursor: 'pointer',
                      }}
                    >
                      {exportOpen ? t('step5.close') : t('step5.open')}
                    </button>
                    {exportOpen && (
                      <div style={{ marginTop: 12 }}>
                        <ModelExportPanel />
                      </div>
                    )}
                  </div>
                )}

                {/* Step 1: surface dataset files the Brain wrote so the user can
                    open/select them — bridges the file store to this step. */}
                {step.n === 1 && datasetFiles.length > 0 && (
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {datasetFiles.map((f) => (
                      <button
                        key={f.path}
                        type="button"
                        onClick={() => onOpenFile?.(f.path)}
                        disabled={!onOpenFile}
                        title={onOpenFile ? `Open ${f.path}` : f.path}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                          fontFamily: "'JetBrains Mono', monospace", fontSize: '0.74rem',
                          background: 'var(--bg-deep)', color: 'var(--text-primary)',
                          border: '1px solid var(--border-subtle)', borderRadius: 8,
                          padding: '6px 10px', cursor: onOpenFile ? 'pointer' : 'default',
                          width: '100%',
                        }}
                      >
                        <span>📋</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {getFileName(f.path)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <p style={{ color: 'var(--text-muted)', fontSize: '0.72rem', lineHeight: 1.5, marginTop: 20 }}>
          {t('footer')}
        </p>
      </div>
    </div>
  );
}
