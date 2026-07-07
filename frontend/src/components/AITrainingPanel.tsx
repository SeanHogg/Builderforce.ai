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
import { hasWebGPUSupport } from '@seanhogg/builderforce-studio';
import { WebGPUTrainer, shouldUseWebGPU, type TrainingStep } from '@/lib/webgpu-trainer';
import { MambaEngine } from '@/lib/mamba-engine';
import { MambaModelProvider, type MambaProviderConfig } from '@/lib/model-provider';

interface AITrainingPanelProps {
  projectId: string | number;
  onLog?: (message: string) => void;
  onJobCompleted?: (job: TrainingJob) => void;
}

type PanelTab = 'configure' | 'datasets' | 'jobs';

const DEFAULT_CONFIG: TrainingConfig = {
  baseModel: 'gpt-neox-20m',
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

export function AITrainingPanel({ projectId, onLog, onJobCompleted }: AITrainingPanelProps) {
  const t = useTranslations('aiTraining');
  const [tab, setTab] = useState<PanelTab>('configure');
  const [trainingMode, setTrainingMode] = useState<TrainingMode>('behavior');
  const [config, setConfig] = useState<TrainingConfig>(DEFAULT_CONFIG);
  const [mambaProviderConfig, setMambaProviderConfig] = useState<MambaProviderConfig>(DEFAULT_MAMBA_PROVIDER_CONFIG);
  const [mambaTrainCode, setMambaTrainCode] = useState('');
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>('');
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
  const canUseWebGPU = selectedModel ? shouldUseWebGPU(selectedModel.maxParams) : false;

  const appendLog = useCallback((msg: string) => {
    setLogs(prev => [...prev, msg]);
    onLog?.(msg);
  }, [onLog]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Load datasets and jobs when the panel opens
  useEffect(() => {
    listDatasets(projectId).then(setDatasets).catch(() => { });
    listTrainingJobs(projectId).then(setJobs).catch(() => { });
  }, [projectId]);

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
      // Create a training job record in the backend
      const job = await createTrainingJob({
        projectId,
        datasetId: selectedDatasetId || undefined,
        baseModel: config.baseModel,
        loraRank: config.loraRank,
        epochs: config.epochs,
        batchSize: config.batchSize,
        learningRate: config.learningRate,
      });
      setActiveJobId(job.id);
      setJobs(prev => [job, ...prev]);
      appendLog(t('logJobCreated', { id: job.id }));

      if (webgpuAvailable && canUseWebGPU) {
        // In-browser WebGPU training — REAL Mamba SSM gradient descent.
        appendLog(t('logWebgpuStart'));
        const trainer = new WebGPUTrainer({
          modelId: config.baseModel,
          workerUrl: getApiBaseUrl(),
          projectId,
          jobId: job.id,
          datasetId: selectedDatasetId || undefined,
          mambaConfig: mambaProviderConfig,
          onLog: appendLog,
          onStep: (step) => {
            setLossHistory(prev => [...prev, step]);
            setJobs(prev => prev.map(j =>
              j.id === job.id
                ? { ...j, current_epoch: step.epoch, current_loss: step.loss, status: 'running' }
                : j
            ));
          },
          onEpochEnd: (epoch, avgLoss) => {
            appendLog(t('logEpochComplete', { epoch, loss: avgLoss.toFixed(4) }));
          },
          onComplete: (artifactKey) => {
            appendLog(t('logTrainingComplete', { key: artifactKey }));
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
              j.id === job.id ? { ...j, status: 'failed', error_message: err.message } : j
            ));
            setIsTraining(false);
          },
        });
        trainerRef.current = trainer;

        await trainer.init();
        // Fallback examples used if no dataset is selected or download fails
        const fallbackExamples = config.capabilityPrompt
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
        const reason = !webgpuAvailable
          ? t('reasonNoWebgpu')
          : t('reasonExceedsBudget', { model: selectedModel?.name ?? config.baseModel });
        appendLog(t('logCannotStart', { reason }));
        setJobs(prev => prev.map(j =>
          j.id === job.id ? { ...j, status: 'failed', error_message: reason } : j
        ));
        setIsTraining(false);
      }
    } catch (e) {
      appendLog(t('logStartFailed', { error: e instanceof Error ? e.message : t('errUnknown') }));
      setIsTraining(false);
    }
  }, [config, selectedModel, selectedDatasetId, projectId, webgpuAvailable, canUseWebGPU, appendLog, onJobCompleted, mambaProviderConfig, t]);

  const handleStopTraining = useCallback(() => {
    trainerRef.current?.stop();
    setIsTraining(false);
    appendLog(t('logStopped'));
  }, [appendLog, t]);

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
    } catch (e) {
      appendLog(t('logEvalFailed', { error: e instanceof Error ? e.message : t('errUnknown') }));
    }
  }, [appendLog, t]);

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
        appendLog(t('logMambaFailInit'));
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
              <span>Mamba</span>
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
                    <span className={`w-1.5 h-1.5 rounded-full ${canUseWebGPU ? 'bg-green-400' : 'bg-orange-400'}`} />
                    {canUseWebGPU ? t('inBrowserWebGPU') : t('cloudOffload')}
                  </div>
                )}
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
                  disabled={isTraining || isGenerating}
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
                    🧪 {t('evaluate')}
                  </button>
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
