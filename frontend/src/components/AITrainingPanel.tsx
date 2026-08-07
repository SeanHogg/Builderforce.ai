'use client';

import { Select } from '@/components/Select';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import {
  SUPPORTED_MODELS,
  type TrainingConfig,
  type TrainingJob,
  type Dataset,
  type TrainingMode,
} from '@/lib/types';
import {
  generateDataset,
  createTrainingJob,
  evaluateModel,
  listDatasets,
  listTrainingJobs,
} from '@/lib/api';
import { getApiBaseUrl } from '@/lib/apiClient';
import { downloadBlob } from '@/lib/download';
import { hasWebGPUSupport } from '@seanhogg/builderforce-studio/capabilities';
import { WebGPUTrainer, canTrainInBrowser, type BrowserLoRAArtifact, type TrainingDataMode, type TrainingStep } from '@/lib/webgpu-trainer';
import { benchmarkPublishedModel, listEvermindModels, publishEvermindModel, rollbackPublishedEvermindModel, testPublishedEvermindModel, type PublishedEvermindModel, type PublishedEvermindResult } from '@/lib/studioModelsApi';
import { MambaEngine } from '@/lib/mamba-engine';
import { MambaModelProvider, type MambaProviderConfig } from '@/lib/model-provider';
import type { HuggingFaceTokenizerSpec } from '@seanhogg/builderforce-memory-engine';

interface AITrainingPanelProps {
  projectId: string | number;
  onLog?: (message: string) => void;
  onJobCompleted?: (job: TrainingJob) => void;
  initialDataMode?: TrainingDataMode;
  workspaceEnabled?: boolean;
  onLocalArtifactCompleted?: (artifact: { filename: string; trainableParams: number }) => void;
  onModelPublished?: (model: PublishedEvermindResult) => void;
}

type PanelTab = 'configure' | 'datasets' | 'jobs';

const DEFAULT_CONFIG: TrainingConfig = {
  baseModel: 'evermind-browser-500k',
  capabilityPrompt: '',
  loraRank: 8,
  epochs: 3,
  batchSize: 4,
  learningRate: 0.0002,
};

/** Default Mamba full-model training config */
const DEFAULT_MAMBA_PROVIDER_CONFIG: MambaProviderConfig = {
  dModel: 512,
  numLayers: 8,
  dState: 16,
  dConv: 4,
  expand: 2,
  wsla: false,
};

export function AITrainingPanel({ projectId, onLog, onJobCompleted, initialDataMode = 'workspace', workspaceEnabled = true, onLocalArtifactCompleted, onModelPublished }: AITrainingPanelProps) {
  const t = useTranslations('aiTraining');
  const [tab, setTab] = useState<PanelTab>('configure');
  const [trainingMode, setTrainingMode] = useState<TrainingMode>('behavior');
  const [config, setConfig] = useState<TrainingConfig>(DEFAULT_CONFIG);
  const [mambaProviderConfig, setMambaProviderConfig] = useState<MambaProviderConfig>(DEFAULT_MAMBA_PROVIDER_CONFIG);
  const [mambaTrainCode, setMambaTrainCode] = useState('');
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>('');
  const [dataMode, setDataMode] = useState<TrainingDataMode>(initialDataMode);
  const [localTrainingText, setLocalTrainingText] = useState('');
  const [completedArtifact, setCompletedArtifact] = useState<BrowserLoRAArtifact | null>(null);
  const [publishName, setPublishName] = useState('');
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishedModel, setPublishedModel] = useState<PublishedEvermindResult | null>(null);
  const [testPrompt, setTestPrompt] = useState('Explain what you learned.');
  const [testOutput, setTestOutput] = useState('');
  const [benchmarkCorpus, setBenchmarkCorpus] = useState('Held-out evaluation text that was not included in browser training.');
  const [benchmarkOutput, setBenchmarkOutput] = useState('');
  const [publishedVersions, setPublishedVersions] = useState<PublishedEvermindModel[]>([]);
  const [rollbackTarget, setRollbackTarget] = useState('');
  const [baseCheckpoint, setBaseCheckpoint] = useState<ArrayBuffer | undefined>();
  const [baseCheckpointName, setBaseCheckpointName] = useState('');
  const [tokenizerSpec, setTokenizerSpec] = useState<HuggingFaceTokenizerSpec | undefined>();
  const [tokenizerName, setTokenizerName] = useState('');
  /** Optional generation model — e.g. an OpenRouter model id; empty = gateway default pool. */
  const [genModel, setGenModel] = useState<string>('');
  const [logs, setLogs] = useState<string[]>([]);
  const [lossHistory, setLossHistory] = useState<TrainingStep[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isTraining, setIsTraining] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [webgpuAvailable] = useState(hasWebGPUSupport);
  const [mambaWebGPU] = useState(hasWebGPUSupport);
  const [memorySequences, setMemorySequences] = useState('');
  const trainerRef = useRef<WebGPUTrainer | null>(null);
  const mambaRef = useRef<MambaEngine | null>(null);
  const mambaProviderRef = useRef<MambaModelProvider | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const selectedModel = SUPPORTED_MODELS.find(m => m.id === config.baseModel);
  const canUseBrowserTraining = selectedModel ? canTrainInBrowser(selectedModel.maxParams) : false;

  const appendLog = useCallback((msg: string) => {
    setLogs(prev => [...prev, msg]);
    onLog?.(msg);
  }, [onLog]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Load datasets and jobs when the panel opens
  useEffect(() => {
    if (!workspaceEnabled) return;
    listDatasets(projectId).then(setDatasets).catch(() => { });
    listTrainingJobs(projectId).then(setJobs).catch(() => { });
  }, [projectId, workspaceEnabled]);

  const handleGenerateDataset = useCallback(async () => {
    if (!config.capabilityPrompt.trim()) return;
    setIsGenerating(true);
    appendLog(t('logGenerating', { prompt: config.capabilityPrompt }));
    try {
      const dataset = await generateDataset(
        projectId,
        config.capabilityPrompt,
        `Dataset for ${config.capabilityPrompt}`,
        (chunk) => appendLog(`  ${chunk}`),
        genModel.trim() || undefined
      );
      appendLog(t('logDatasetReady', { count: dataset.example_count, id: dataset.id }));
      setDatasets(prev => [dataset, ...prev]);
      setSelectedDatasetId(dataset.id);
    } catch (e) {
      appendLog(t('logDatasetFailed', { error: e instanceof Error ? e.message : t('errUnknown') }));
    } finally {
      setIsGenerating(false);
    }
  }, [config.capabilityPrompt, projectId, appendLog, genModel, t]);

  const handleStartTraining = useCallback(async () => {
    if (!config.baseModel) return;
    setIsTraining(true);
    setLossHistory([]);
    appendLog(t('logStartTraining', { model: selectedModel?.name ?? config.baseModel }));

    try {
      const job = dataMode === 'workspace' ? await createTrainingJob({
          projectId,
          datasetId: selectedDatasetId || undefined,
          baseModel: config.baseModel,
          loraRank: config.loraRank,
          epochs: config.epochs,
          batchSize: config.batchSize,
          learningRate: config.learningRate,
        }) : null;
      if (job) {
        setActiveJobId(job.id);
        setJobs(prev => [job, ...prev]);
        appendLog(t('logJobCreated', { id: job.id }));
      } else {
        appendLog('Local-only mode: no dataset, logs, job record, or adapter will be sent to Builderforce.');
      }

      if (canUseBrowserTraining) {
        appendLog('Starting real frozen-base browser LoRA training.');
        const trainer = new WebGPUTrainer({
          modelId: config.baseModel,
          workerUrl: getApiBaseUrl(),
          projectId,
          jobId: job?.id,
          datasetId: dataMode === 'workspace' ? selectedDatasetId || undefined : undefined,
          dataMode,
          baseCheckpoint,
          tokenizerSpec,
          modelConfig: selectedModel?.modelConfig,
          onLog: appendLog,
          onStep: (step) => {
            setLossHistory(prev => [...prev, step]);
            setJobs(prev => prev.map(j =>
              j.id === job?.id
                ? { ...j, current_epoch: step.epoch, current_loss: step.loss, status: 'running' }
                : j
            ));
          },
          onEpochEnd: (epoch, avgLoss) => {
            appendLog(t('logEpochComplete', { epoch, loss: avgLoss.toFixed(4) }));
          },
          onComplete: (artifactKey) => {
            appendLog(t('logTrainingComplete', { key: artifactKey }));
            if (!job) { setIsTraining(false); return; }
            setJobs(prev => {
              const completedJob = { ...prev.find(j => j.id === job.id)!, status: 'completed' as const, r2_artifact_key: artifactKey };
              onJobCompleted?.(completedJob);
              return prev.map(j => j.id === job.id ? completedJob : j);
            });
            setIsTraining(false);
          },
          onError: (err) => {
            appendLog(t('logTrainingError', { error: err.message }));
            setJobs(prev => prev.map(j =>
              j.id === job?.id ? { ...j, status: 'failed', error_message: err.message } : j
            ));
            setIsTraining(false);
          },
          onArtifact: (artifact) => {
            setCompletedArtifact(artifact);
            setPublishName(`${selectedModel?.name ?? config.baseModel} Adapter`);
            if (dataMode === 'local-only') {
              downloadBlob(new Blob([artifact.bytes], { type: 'application/x-safetensors' }), artifact.filename);
              appendLog(`Downloaded ${artifact.filename}; ${artifact.trainableParams.toLocaleString()} trainable parameters.`);
              onLocalArtifactCompleted?.({ filename: artifact.filename, trainableParams: artifact.trainableParams });
            }
          },
        });
        trainerRef.current = trainer;

        await trainer.init();
        // Fallback examples used if no dataset is selected or download fails
        const fallbackExamples = dataMode === 'local-only'
          ? localTrainingText.split(/\n{2,}/).map((text) => text.trim()).filter(Boolean)
          : config.capabilityPrompt
            ? [`${config.capabilityPrompt} — example 1`, `${config.capabilityPrompt} — example 2`]
            : ['General coding task example'];
        const TARGET_EFFECTIVE_BATCH_SIZE = 16;
        await trainer.train(
          {
            epochs: config.epochs,
            batchSize: config.batchSize,
            learningRate: config.learningRate,
            gradientAccumulationSteps: Math.max(1, Math.floor(TARGET_EFFECTIVE_BATCH_SIZE / config.batchSize)),
            precision: 'float16',
            loraConfig: { rank: config.loraRank, alpha: config.loraRank * 2, targetModules: ['q_proj', 'v_proj'] },
          },
          fallbackExamples,
        );
        trainerRef.current = null;
      } else {
        // In-browser WebGPU training only runs for models within the WebGPU
        // parameter budget. There is no real cloud-offload training pipeline
        // wired here yet — so rather than fabricate a loss curve, fail honestly.
        const reason = `The selected model exceeds the ${20}M-parameter exact browser LoRA limit.`;
        appendLog(t('logCannotStart', { reason }));
        setJobs(prev => prev.map(j =>
          j.id === job?.id ? { ...j, status: 'failed', error_message: reason } : j
        ));
        setIsTraining(false);
      }
    } catch (e) {
      appendLog(t('logStartFailed', { error: e instanceof Error ? e.message : t('errUnknown') }));
      setIsTraining(false);
    }
  }, [config, selectedModel, selectedDatasetId, projectId, dataMode, localTrainingText, baseCheckpoint, tokenizerSpec, canUseBrowserTraining, appendLog, onJobCompleted, onLocalArtifactCompleted, t]);

  const handleStopTraining = useCallback(() => {
    trainerRef.current?.stop();
    setIsTraining(false);
    appendLog(t('logStopped'));
  }, [appendLog, t]);

  const handlePublishModel = useCallback(async () => {
    if (!completedArtifact || !publishName.trim()) return;
    setIsPublishing(true);
    try {
      const published = await publishEvermindModel({
        name: publishName.trim(),
        model: completedArtifact.evermindPackage,
        tokenizer: completedArtifact.tokenizer,
        description: `LoRA adapter merged from ${config.baseModel}`,
        heldOutCorpus: benchmarkCorpus,
        qualityGate: { maxPerplexity: 1_000, minTop1Accuracy: 0 },
      });
      setPublishedModel(published);
      void listEvermindModels().then((models) => setPublishedVersions(models.filter((model) => model.slug !== published.slug))).catch(() => undefined);
      appendLog(`Published ${published.name} as ${published.ref}.`);
      onModelPublished?.(published);
    } catch (error) {
      appendLog(`Publish failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsPublishing(false);
    }
  }, [appendLog, benchmarkCorpus, completedArtifact, config.baseModel, onModelPublished, publishName]);

  const handleTestPublished = useCallback(async () => {
    if (!publishedModel || !testPrompt.trim()) return;
    setTestOutput('Testing…');
    try {
      const result = await testPublishedEvermindModel(publishedModel.slug, testPrompt.trim());
      setTestOutput(result.choices?.[0]?.message?.content || 'Model returned no text.');
    } catch (error) {
      setTestOutput(error instanceof Error ? error.message : String(error));
    }
  }, [publishedModel, testPrompt]);

  const handleBenchmarkPublished = useCallback(async () => {
    if (!publishedModel || benchmarkCorpus.trim().length < 20) return;
    setBenchmarkOutput('Benchmarking immutable package…');
    try {
      const result = await benchmarkPublishedModel(publishedModel.slug, benchmarkCorpus.trim());
      setBenchmarkOutput(`Perplexity ${result.perplexity.toFixed(3)} · top-1 ${(result.top1Accuracy * 100).toFixed(1)}% · top-${result.topK} ${(result.topKAccuracy * 100).toFixed(1)}% · ${result.tokensPerSecond?.toFixed(1) ?? '—'} tok/s`);
    } catch (error) { setBenchmarkOutput(error instanceof Error ? error.message : String(error)); }
  }, [benchmarkCorpus, publishedModel]);

  const handleRollbackPublished = useCallback(async () => {
    if (!publishedModel || !rollbackTarget) return;
    try {
      const result = await rollbackPublishedEvermindModel(publishedModel.slug, { targetSlug: rollbackTarget });
      appendLog(`Rolled ${publishedModel.ref} back to ${result.activeBaseModel}. Reversal token: ${result.rollbackToken}`);
      setBenchmarkOutput('Model version changed. Run the held-out benchmark again before approval.');
    } catch (error) { appendLog(`Rollback failed: ${error instanceof Error ? error.message : String(error)}`); }
  }, [appendLog, publishedModel, rollbackTarget]);

  /** Memory Training — advance Mamba state through provided sequences */
  const handleMemoryTraining = useCallback(async () => {
    const sequences = memorySequences
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
    if (sequences.length === 0) {
      appendLog(t('logNoSequences'));
      return;
    }
    setIsTraining(true);
    appendLog(t('logMemoryStart', { count: sequences.length }));

    try {
      const { MambaEngine } = await import('@/lib/mamba-engine');
      const engine = new MambaEngine(`project-${projectId}`, projectId);
      await engine.init();
      await engine.loadFromIndexedDB();
      mambaRef.current = engine;

      await engine.trainMemory(sequences, (i, total) => {
        appendLog(t('logMemoryProcessed', { i, total, seq: sequences[i - 1]?.slice(0, 60) ?? '' }));
      });

      await engine.save();
      const snap = engine.getSnapshot();
      appendLog(t('logMemoryComplete', { step: snap.step, channels: snap.channels }));
    } catch (e) {
      appendLog(t('logMemoryFailed', { error: e instanceof Error ? e.message : t('errUnknown') }));
    } finally {
      setIsTraining(false);
    }
  }, [memorySequences, projectId, appendLog, t]);

  const handleEvaluate = useCallback(async (jobId: string) => {
    appendLog(t('logEvaluating', { id: jobId }));
    try {
      const result = await evaluateModel(jobId);
      appendLog(t('logEvalResults'));
      appendLog(t('logEvalScore', { value: (result.score * 100).toFixed(1) }));
      appendLog(t('logEvalCode', { value: ((result.code_correctness ?? 0) * 100).toFixed(1) }));
      appendLog(t('logEvalReasoning', { value: ((result.reasoning_quality ?? 0) * 100).toFixed(1) }));
      appendLog(t('logEvalHallucination', { value: ((result.hallucination_rate ?? 0) * 100).toFixed(1) }));
      appendLog(t('logEvalDetails', { details: result.details }));
      // Reload jobs so the now-persisted eval breakdown renders durably on the card.
      listTrainingJobs(projectId).then(setJobs).catch(() => { });
    } catch (e) {
      appendLog(t('logEvalFailed', { error: e instanceof Error ? e.message : t('errUnknown') }));
    }
  }, [appendLog, t, projectId]);

  /** Mamba Full-Model Training — trains the actual Mamba model weights via the builderforce-memory engine */
  const handleMambaModelTraining = useCallback(async () => {
    if (!mambaTrainCode.trim()) {
      appendLog(t('logNoCode'));
      return;
    }
    setIsTraining(true);
    appendLog(t('logMambaInit'));
    try {
      const provider = new MambaModelProvider(mambaProviderConfig);
      mambaProviderRef.current = provider;
      await provider.init();

      if (!provider.isReady()) {
        appendLog(t('logMambaFailInit', { reason: provider.failureReason() ?? t('errUnknown') }));
        return;
      }

      appendLog(t('logMambaReady', { epochs: config.epochs, wsla: mambaProviderConfig.wsla ? t('wslaModeSuffix') : '' }));
      const losses = await provider.train(mambaTrainCode, {
        learningRate: 1e-4,
        epochs: config.epochs,
        wsla: mambaProviderConfig.wsla,
        onEpochEnd: (epoch, loss) => {
          appendLog(t('logMambaEpoch', { epoch, loss: loss.toFixed(4) }));
          setLossHistory(prev => [...prev, { epoch, step: epoch, loss, learningRate: 1e-4 }]);
        },
      });
      appendLog(t('logMambaComplete', { loss: (losses[losses.length - 1] ?? 0).toFixed(4) }));
    } catch (e) {
      appendLog(t('logMambaFailed', { error: e instanceof Error ? e.message : t('errUnknown') }));
    } finally {
      setIsTraining(false);
    }
  }, [mambaTrainCode, mambaProviderConfig, config.epochs, appendLog, t]);

  /** Hybrid Training — memory pass first, then LoRA behavior pass */
  const handleHybridTraining = useCallback(async () => {
    await handleMemoryTraining();
    await handleStartTraining();
  }, [handleMemoryTraining, handleStartTraining]);

  const maxLoss = lossHistory.length > 0 ? Math.max(...lossHistory.map(s => s.loss)) : 3;

  const MODE_LABELS: Record<TrainingMode, string> = {
    behavior: `⚙️ ${t('modeBehavior')}`,
    memory: `🧬 ${t('modeMemory')}`,
    hybrid: `🔮 ${t('modeHybrid')}`,
    mamba: `🐍 ${t('modeMamba')}`,
  };

  return (
    <div className="h-full flex flex-col text-sm" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      {/* Header */}
      <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <h2 className="font-semibold flex items-center gap-1" style={{ color: 'var(--text-primary)' }}>
          <span>🧠</span> {t('title')}
        </h2>
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <span className={`w-2 h-2 rounded-full ${webgpuAvailable ? 'bg-green-400' : 'bg-yellow-400'}`} />
          <span>{webgpuAvailable ? 'WebGPU' : 'CPU'}</span>
          {mambaWebGPU && (
            <>
              <span className="w-2 h-2 rounded-full bg-purple-400" />
              <span>{'Mamba'}</span>
            </>
          )}
        </div>
      </div>

      {/* Tabs — theme-aware so readable in light mode */}
      <div className="flex" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        {([['configure', t('tabConfigure')], ['datasets', t('tabDatasets')], ['jobs', t('tabJobs')]] as [PanelTab, string][]).map(([tabId, label]) => (
          <button
            key={tabId}
            onClick={() => setTab(tabId)}
            style={{
              padding: '6px 12px',
              fontSize: '0.75rem',
              background: tab === tabId ? 'var(--bg-elevated)' : 'transparent',
              color: tab === tabId ? 'var(--text-primary)' : 'var(--text-secondary)',
              border: 'none',
              borderTop: tab === tabId ? '2px solid var(--coral-bright)' : '2px solid transparent',
              cursor: 'pointer',
              fontFamily: 'var(--font-display)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Configure Tab */}
        {tab === 'configure' && (
          <div className="p-3 space-y-3">
            {/* Training Mode Selector */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t('trainingMode')}</label>
              <div className="flex rounded overflow-hidden border border-gray-700">
                {(['behavior', 'memory', 'hybrid', 'mamba'] as TrainingMode[]).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setTrainingMode(mode)}
                    className={`flex-1 py-1.5 text-xs font-semibold transition-colors ${
                      trainingMode === mode
                        ? 'bg-indigo-700 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    {MODE_LABELS[mode]}
                  </button>
                ))}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                {trainingMode === 'behavior' && t('descBehavior')}
                {trainingMode === 'memory' && t('descMemory')}
                {trainingMode === 'hybrid' && t('descHybrid')}
                {trainingMode === 'mamba' && t('descMamba')}
              </div>
            </div>

            {/* Mamba Full-Model Training UI */}
            {trainingMode === 'mamba' && (
              <div className="space-y-2">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t('trainingCode')}</label>
                  <textarea
                    value={mambaTrainCode}
                    onChange={e => setMambaTrainCode(e.target.value)}
                    placeholder={t('trainingCodePlaceholder')}
                    className="w-full bg-gray-800 text-gray-100 text-xs rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none resize-none font-mono"
                    rows={5}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">{t('modelDim')}</label>
                    <input
                      type="number"
                      min={64}
                      max={2048}
                      step={64}
                      value={mambaProviderConfig.dModel ?? 512}
                      onChange={e => setMambaProviderConfig(c => ({ ...c, dModel: parseInt(e.target.value) || 512 }))}
                      className="w-full bg-gray-800 text-gray-100 text-xs rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">{t('layers')}</label>
                    <input
                      type="number"
                      min={1}
                      max={32}
                      value={mambaProviderConfig.numLayers ?? 8}
                      onChange={e => setMambaProviderConfig(c => ({ ...c, numLayers: parseInt(e.target.value) || 8 }))}
                      className="w-full bg-gray-800 text-gray-100 text-xs rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">{t('epochs')}</label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={config.epochs}
                      onChange={e => setConfig(c => ({ ...c, epochs: parseInt(e.target.value) || 3 }))}
                      className="w-full bg-gray-800 text-gray-100 text-xs rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none"
                    />
                  </div>
                  <div className="flex items-end pb-1.5">
                    <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs text-gray-300">
                      <input
                        type="checkbox"
                        checked={mambaProviderConfig.wsla ?? false}
                        onChange={e => setMambaProviderConfig(c => ({ ...c, wsla: e.target.checked }))}
                        className="accent-purple-500"
                      />
                      {t('wslaMode')}
                    </label>
                  </div>
                </div>
                <div className="text-xs text-gray-500">
                  {mambaProviderConfig.wsla ? t('wslaOn') : t('wslaOff')}
                </div>
              </div>
            )}

            {/* Memory Training UI */}
            {(trainingMode === 'memory' || trainingMode === 'hybrid') && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('memorySequences')}</label>
                <textarea
                  value={memorySequences}
                  onChange={e => setMemorySequences(e.target.value)}
                  placeholder={t('memoryPlaceholder')}
                  className="w-full bg-gray-800 text-gray-100 text-xs rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none resize-none"
                  rows={4}
                />
                <div className="text-xs text-gray-500 mt-0.5">
                  {t('memoryHint')}
                </div>
              </div>
            )}

            {/* Model selection — shown for behavior + hybrid */}
            {(trainingMode === 'behavior' || trainingMode === 'hybrid') && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('baseModel')}</label>
                <Select
                  value={config.baseModel}
                  onChange={e => setConfig(c => ({ ...c, baseModel: e.target.value }))}
                  className="w-full bg-gray-800 text-gray-100 text-xs rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none"
                >
                  {SUPPORTED_MODELS.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.parameters}) — {m.task}
                    </option>
                  ))}
                </Select>
                {selectedModel && (
                  <div className="mt-1 text-xs text-gray-500 flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${canUseBrowserTraining ? 'bg-green-400' : 'bg-orange-400'}`} />
                    {canUseBrowserTraining ? (webgpuAvailable ? 'Hybrid WebGPU LoRA · WGSL adapter kernels' : 'Exact browser LoRA · CPU fallback') : t('cloudOffload')}
                  </div>
                )}
                <details className="mt-2 rounded border border-gray-700 bg-gray-900 p-2">
                  <summary className="cursor-pointer text-xs text-gray-300">Warm-start from a compatible Evermind checkpoint</summary>
                  <div className="mt-2 space-y-2 text-xs text-gray-400">
                    <label className="block">Base `.safetensors`
                      <input type="file" accept=".safetensors,application/octet-stream" className="mt-1 block w-full text-xs" onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) { setBaseCheckpoint(undefined); setBaseCheckpointName(''); return; }
                        void file.arrayBuffer().then((bytes) => { setBaseCheckpoint(bytes); setBaseCheckpointName(file.name); });
                      }} />
                    </label>
                    <label className="block">Matching Hugging Face `tokenizer.json`
                      <input type="file" accept=".json,application/json" className="mt-1 block w-full text-xs" onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) { setTokenizerSpec(undefined); setTokenizerName(''); return; }
                        void file.text().then((text) => { setTokenizerSpec(JSON.parse(text) as HuggingFaceTokenizerSpec); setTokenizerName(file.name); }).catch(() => appendLog('Tokenizer JSON could not be parsed.'));
                      }} />
                    </label>
                    <div>{baseCheckpointName || 'No base selected'} · {tokenizerName || 'No tokenizer selected'}</div>
                    {(baseCheckpoint && !tokenizerSpec) || (!baseCheckpoint && tokenizerSpec) ? <div className="text-amber-400">Select both files; their vocabulary and tensor shapes are verified before training.</div> : null}
                  </div>
                </details>
              </div>
            )}
            {/* Capability prompt — shown for behavior + hybrid */}
            {(trainingMode === 'behavior' || trainingMode === 'hybrid') && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('capabilityPrompt')}</label>
                <textarea
                  value={config.capabilityPrompt}
                  onChange={e => setConfig(c => ({ ...c, capabilityPrompt: e.target.value }))}
                  placeholder={t('capabilityPlaceholder')}
                  className="w-full bg-gray-800 text-gray-100 text-xs rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none resize-none"
                  rows={3}
                />
              </div>
            )}

            {/* Dataset — shown for behavior + hybrid */}
            {(trainingMode === 'behavior' || trainingMode === 'hybrid') && (
              <div>
                <div className="mb-2 rounded border border-gray-700 bg-gray-900 p-2">
                  <label className="block text-xs text-gray-400 mb-1">Data boundary</label>
                  <Select
                    value={dataMode}
                    onChange={e => setDataMode(e.target.value as TrainingDataMode)}
                    className="w-full bg-gray-800 text-gray-100 text-xs rounded px-2 py-1.5 border border-gray-700"
                  >
                    <option value="workspace" disabled={!workspaceEnabled}>Workspace — load and save through Builderforce</option>
                    <option value="local-only">Local only — never upload data, logs, or adapter</option>
                  </Select>
                </div>
                {dataMode === 'local-only' ? (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Local training examples</label>
                    <textarea
                      value={localTrainingText}
                      onChange={e => setLocalTrainingText(e.target.value)}
                      placeholder="Paste examples here. Separate examples with a blank line."
                      className="w-full bg-gray-800 text-gray-100 text-xs rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none resize-y"
                      rows={6}
                    />
                    <div className="mt-1 text-xs text-green-400">Enforced locally: no training API job, dataset request, log stream, or artifact upload.</div>
                  </div>
                ) : (
                <>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-gray-400">{t('trainingDataset')}</label>
                  <button
                    onClick={handleGenerateDataset}
                    disabled={isGenerating || !config.capabilityPrompt.trim()}
                    className="text-xs bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white px-2 py-0.5 rounded"
                  >
                    {isGenerating ? `⏳ ${t('generating')}` : `✨ ${t('generate')}`}
                  </button>
                </div>
                <Select
                  value={selectedDatasetId}
                  onChange={e => setSelectedDatasetId(e.target.value)}
                  className="w-full bg-gray-800 text-gray-100 text-xs rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none"
                >
                  <option value="">{t('noDataset')}</option>
                  {datasets.map(d => (
                    <option key={d.id} value={d.id}>
                      {t('datasetOption', { name: d.name, count: d.example_count })}
                    </option>
                  ))}
                </Select>
                <input
                  type="text"
                  value={genModel}
                  onChange={e => setGenModel(e.target.value)}
                  placeholder={t('genModelPlaceholder')}
                  className="w-full mt-1 bg-gray-800 text-gray-100 text-xs rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none"
                  title={t('genModelTitle')}
                />
                </>
                )}
              </div>
            )}

            {/* Training parameters — shown for behavior + hybrid */}
            {(trainingMode === 'behavior' || trainingMode === 'hybrid') && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t('loraRank')}</label>
                  <input
                    type="number"
                    min={1}
                    max={64}
                    value={config.loraRank}
                    onChange={e => setConfig(c => ({ ...c, loraRank: parseInt(e.target.value) || 8 }))}
                    className="w-full bg-gray-800 text-gray-100 text-xs rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t('epochs')}</label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={config.epochs}
                    onChange={e => setConfig(c => ({ ...c, epochs: parseInt(e.target.value) || 3 }))}
                    className="w-full bg-gray-800 text-gray-100 text-xs rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t('batchSize')}</label>
                  <input
                    type="number"
                    min={1}
                    max={32}
                    value={config.batchSize}
                    onChange={e => setConfig(c => ({ ...c, batchSize: parseInt(e.target.value) || 4 }))}
                    className="w-full bg-gray-800 text-gray-100 text-xs rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t('learningRate')}</label>
                  <input
                    type="number"
                    step={0.00001}
                    min={0.000001}
                    max={0.01}
                    value={config.learningRate}
                    onChange={e => setConfig(c => ({ ...c, learningRate: parseFloat(e.target.value) || 0.0002 }))}
                    className="w-full bg-gray-800 text-gray-100 text-xs rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none"
                  />
                </div>
              </div>
            )}

            {/* Train button */}
            <div className="flex gap-2">
              {trainingMode === 'mamba' ? (
                <button
                  onClick={handleMambaModelTraining}
                  disabled={isTraining || !mambaTrainCode.trim()}
                  className="flex-1 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white px-3 py-2 rounded text-xs font-semibold"
                >
                  {isTraining ? `⏳ ${t('training')}` : `🐍 ${t('trainMamba')}`}
                </button>
              ) : trainingMode === 'memory' ? (
                <button
                  onClick={handleMemoryTraining}
                  disabled={isTraining || !memorySequences.trim()}
                  className="flex-1 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white px-3 py-2 rounded text-xs font-semibold"
                >
                  {isTraining ? `⏳ ${t('training')}` : `🧬 ${t('trainMemory')}`}
                </button>
              ) : trainingMode === 'hybrid' ? (
                <button
                  onClick={handleHybridTraining}
                  disabled={isTraining || isGenerating}
                  className="flex-1 bg-gradient-to-r from-purple-700 to-green-700 hover:from-purple-600 hover:to-green-600 disabled:opacity-50 text-white px-3 py-2 rounded text-xs font-semibold"
                >
                  {isTraining ? `⏳ ${t('training')}` : `🔮 ${t('startHybrid')}`}
                </button>
              ) : (
                <button
                  onClick={handleStartTraining}
                  disabled={isTraining || isGenerating || (dataMode === 'local-only' && !localTrainingText.trim()) || (!!baseCheckpoint !== !!tokenizerSpec)}
                  className="flex-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-3 py-2 rounded text-xs font-semibold"
                >
                  {isTraining ? `⏳ ${t('training')}` : `▶ ${t('startTraining')}`}
                </button>
              )}
              {isTraining && (
                <button
                  onClick={handleStopTraining}
                  className="bg-red-700 hover:bg-red-600 text-white px-3 py-2 rounded text-xs"
                >
                  ⏹ {t('stop')}
                </button>
              )}
            </div>

            {/* Loss curve */}
            {lossHistory.length > 0 && (
              <div>
                <div className="text-xs text-gray-400 mb-1">
                  {t('lossCurve', { loss: lossHistory[lossHistory.length - 1]?.loss.toFixed(4) ?? '' })}
                </div>
                <div className="bg-gray-800 rounded p-2 h-20 flex items-end gap-px overflow-hidden">
                  {lossHistory.slice(-60).map((s, i) => (
                    <div
                      key={i}
                      className="bg-blue-500 opacity-80 flex-1 min-w-0 rounded-sm"
                      style={{ height: `${Math.max(4, (s.loss / maxLoss) * 100)}%` }}
                      title={t('lossBarTitle', { epoch: s.epoch, step: s.step, loss: s.loss.toFixed(4) })}
                    />
                  ))}
                </div>
              </div>
            )}

            {completedArtifact && (
              <div className="rounded border border-emerald-800 bg-emerald-950/30 p-2 space-y-2">
                <div className="text-xs text-emerald-300">
                  Runnable package ready · {(completedArtifact.evermindPackage.byteLength / 1024).toFixed(1)} KB · {completedArtifact.trainableParams.toLocaleString()} adapter parameters
                </div>
                <input
                  value={publishName}
                  onChange={(event) => setPublishName(event.target.value)}
                  aria-label="Published model name"
                  className="w-full bg-gray-900 text-gray-100 text-xs rounded px-2 py-1.5 border border-gray-700"
                />
                <button type="button" onClick={handlePublishModel} disabled={isPublishing || !publishName.trim() || benchmarkCorpus.trim().length < 20} className="w-full bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white px-3 py-2 rounded text-xs font-semibold">
                  {isPublishing ? 'Publishing…' : publishedModel ? 'Publish new version' : 'Publish callable Evermind model'}
                </button>
                {publishedModel && <div className="space-y-2">
                  <div className="text-xs text-emerald-300">Callable as <code>{publishedModel.ref}</code></div>
                  <textarea value={testPrompt} onChange={(event) => setTestPrompt(event.target.value)} aria-label="Published model test prompt" rows={2} className="w-full bg-gray-900 text-gray-100 text-xs rounded px-2 py-1.5 border border-gray-700" />
                  <button type="button" onClick={handleTestPublished} className="w-full bg-purple-700 hover:bg-purple-600 text-white px-3 py-1.5 rounded text-xs">Test published runtime</button>
                  {testOutput && <pre className="whitespace-pre-wrap rounded bg-gray-950 p-2 text-xs text-gray-300">{testOutput}</pre>}
                  <textarea value={benchmarkCorpus} onChange={(event) => setBenchmarkCorpus(event.target.value)} aria-label="Held-out benchmark corpus" rows={3} className="w-full bg-gray-900 text-gray-100 text-xs rounded px-2 py-1.5 border border-gray-700" />
                  <button type="button" onClick={handleBenchmarkPublished} disabled={benchmarkCorpus.trim().length < 20} className="w-full bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white px-3 py-1.5 rounded text-xs">Benchmark published package</button>
                  {benchmarkOutput && <div className="rounded bg-gray-950 p-2 text-xs text-gray-300">{benchmarkOutput}</div>}
                  {publishedVersions.length > 0 && <div className="flex gap-2"><select value={rollbackTarget} onChange={(event) => setRollbackTarget(event.target.value)} aria-label="Rollback model version" className="min-w-0 flex-1 bg-gray-900 text-gray-100 text-xs rounded px-2 border border-gray-700"><option value="">Choose prior published package</option>{publishedVersions.map((model) => <option key={model.slug} value={model.slug}>{model.name}</option>)}</select><button type="button" disabled={!rollbackTarget} onClick={handleRollbackPublished} className="bg-amber-700 disabled:opacity-50 text-white px-2 py-1.5 rounded text-xs">Roll back</button></div>}
                </div>}
              </div>
            )}

            {/* Training logs */}
            {logs.length > 0 && (
              <div>
                <div className="text-xs text-gray-400 mb-1">{t('trainingLogs')}</div>
                <div className="bg-gray-950 rounded p-2 h-32 overflow-y-auto font-mono text-xs text-green-400">
                  {logs.map((log, i) => (
                    <div key={i}>{log}</div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Datasets Tab */}
        {tab === 'datasets' && (
          <div className="p-3 space-y-2">
            <div className="text-xs text-gray-400 mb-2">
              {t('datasetsCount', { count: datasets.length })}
            </div>
            {datasets.length === 0 && (
              <div className="text-center text-gray-500 text-xs py-6">
                <div className="text-2xl mb-2">📦</div>
                {t('noDatasets')}
              </div>
            )}
            {datasets.map(d => (
              <div key={d.id} className="bg-gray-800 rounded p-2 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-xs">{d.name}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${d.status === 'ready' ? 'bg-green-900 text-green-300' :
                      d.status === 'generating' ? 'bg-blue-900 text-blue-300' :
                        d.status === 'error' ? 'bg-red-900 text-red-300' :
                          'bg-gray-700 text-gray-300'
                    }`}>{d.status}</span>
                </div>
                <div className="text-xs text-gray-400">{d.capability_prompt}</div>
                <div className="text-xs text-gray-500">{t('examples', { count: d.example_count })}</div>
              </div>
            ))}
          </div>
        )}

        {/* Jobs Tab */}
        {tab === 'jobs' && (
          <div className="p-3 space-y-2">
            <div className="text-xs text-gray-400 mb-2">
              {t('jobsCount', { count: jobs.length })}
            </div>
            {jobs.length === 0 && (
              <div className="text-center text-gray-500 text-xs py-6">
                <div className="text-2xl mb-2">🤖</div>
                {t('noJobs')}
              </div>
            )}
            {jobs.map(job => (
              <div key={job.id} className="bg-gray-800 rounded p-2 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-xs truncate max-w-32">{job.base_model}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${job.status === 'completed' ? 'bg-green-900 text-green-300' :
                      job.status === 'running' ? 'bg-blue-900 text-blue-300' :
                        job.status === 'failed' ? 'bg-red-900 text-red-300' :
                          'bg-gray-700 text-gray-300'
                    }`}>{job.status}</span>
                </div>
                <div className="text-xs text-gray-400">
                  {t('epochProgress', { current: job.current_epoch, total: job.epochs })}
                  {job.current_loss != null && ` — ${t('lossValue', { loss: job.current_loss.toFixed(4) })}`}
                </div>
                <div className="text-xs text-gray-500">
                  {t('jobParams', { rank: job.lora_rank, lr: job.learning_rate, bs: job.batch_size })}
                </div>
                {job.status === 'completed' && (
                  <button
                    onClick={() => handleEvaluate(job.id)}
                    className="text-xs bg-purple-700 hover:bg-purple-600 text-white px-2 py-0.5 rounded"
                  >
                    🧪 {job.eval_score != null ? t('reEvaluate') : t('evaluate')}
                  </button>
                )}
                {job.eval_score != null && (
                  <div className="mt-1 rounded bg-gray-900 border border-gray-700 p-1.5 space-y-0.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-400">{t('evalScoreLabel')}</span>
                      <span className="font-semibold tabular-nums text-gray-100">{(job.eval_score * 100).toFixed(0)}%</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500">{t('evalCodeLabel')}</span>
                      <span className="tabular-nums text-gray-300">{((job.eval_code_correctness ?? 0) * 100).toFixed(0)}%</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500">{t('evalReasoningLabel')}</span>
                      <span className="tabular-nums text-gray-300">{((job.eval_reasoning_quality ?? 0) * 100).toFixed(0)}%</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500">{t('evalHallucinationLabel')}</span>
                      <span className="tabular-nums text-gray-300">{((job.eval_hallucination_rate ?? 0) * 100).toFixed(0)}%</span>
                    </div>
                    {job.eval_details && <div className="text-xs text-gray-500 pt-0.5 leading-snug">{job.eval_details}</div>}
                  </div>
                )}
                {job.error_message && (
                  <div className="text-xs text-red-400 mt-1">{job.error_message}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
