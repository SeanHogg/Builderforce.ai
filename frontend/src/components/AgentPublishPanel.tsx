'use client';

import { Select } from '@/components/Select';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import type { TrainingJob, AgentProfile, AgentPackage, MambaStateSnapshot } from '@/lib/types';
import { publishAgent, validateAgent, ingestAgentKnowledge, type ValidateAgentResult } from '@/lib/api';
import ModelApiSamples from '@/components/ModelApiSamples';
import { MambaEngine } from '@/lib/mamba-engine';

const INSTALL_COMMAND = 'iwr -useb https://builderforce.ai/install.ps1 | iex';

interface AgentPublishPanelProps {
  projectId: string | number;
  completedJobs: TrainingJob[];
}

type PanelTab = 'profile' | 'download' | 'publish';

const DEFAULT_PROFILE: AgentProfile = {
  name: '',
  title: '',
  bio: '',
  skills: [],
  resumeMarkdown: '',
};

function buildPackage(
  profile: AgentProfile,
  job: TrainingJob | undefined,
  mambaSnapshot?: MambaStateSnapshot | null
): AgentPackage {
  const base: AgentPackage = {
    version: mambaSnapshot ? '2.0' : '1.0',
    platform: 'builderforce.ai',
    name: profile.name,
    title: profile.title,
    bio: profile.bio,
    skills: profile.skills,
    base_model: job?.base_model ?? '',
    lora_config: {
      rank: job?.lora_rank ?? 8,
      alpha: (job?.lora_rank ?? 8) * 2,
      target_modules: ['q_proj', 'v_proj'],
    },
    training_job_id: job?.id,
    r2_artifact_key: job?.r2_artifact_key,
    resume_md: profile.resumeMarkdown || undefined,
    created_at: new Date().toISOString(),
  };
  if (mambaSnapshot) {
    base.mamba_state = mambaSnapshot;
  }
  return base;
}

export function AgentPublishPanel({ projectId, completedJobs }: AgentPublishPanelProps) {
  const [tab, setTab] = useState<PanelTab>('profile');
  const [profile, setProfile] = useState<AgentProfile>(DEFAULT_PROFILE);
  const [skillInput, setSkillInput] = useState('');
  const [selectedJobId, setSelectedJobId] = useState<string>(completedJobs[0]?.id ?? '');
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishedId, setPublishedId] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [validation, setValidation] = useState<ValidateAgentResult | null>(null);
  const [copiedInstall, setCopiedInstall] = useState(false);
  const [includeMamba, setIncludeMamba] = useState(false);
  const [mambaSnapshot, setMambaSnapshot] = useState<MambaStateSnapshot | null>(null);
  const [knowledgeText, setKnowledgeText] = useState('');
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestResult, setIngestResult] = useState<{ chunks: number } | null>(null);
  const [ingestError, setIngestError] = useState<string | null>(null);

  const handleIngestKnowledge = useCallback(async () => {
    if (!publishedId || !knowledgeText.trim()) return;
    setIsIngesting(true);
    setIngestError(null);
    setIngestResult(null);
    try {
      const result = await ingestAgentKnowledge(publishedId, { text: knowledgeText });
      setIngestResult(result);
    } catch (err) {
      setIngestError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsIngesting(false);
    }
  }, [publishedId, knowledgeText]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load Mamba snapshot from IndexedDB when toggled on
  useEffect(() => {
    if (!includeMamba) { setMambaSnapshot(null); return; }
    let cancelled = false;
    const engine = new MambaEngine(`project-${projectId}`, projectId);
    engine.init()
      .then(() => engine.loadFromIndexedDB())
      .then(() => {
        if (!cancelled) setMambaSnapshot(engine.getSnapshot());
      })
      .catch(() => { if (!cancelled) setMambaSnapshot(null); });
    return () => { cancelled = true; };
  }, [includeMamba, projectId]);

  const selectedJob = completedJobs.find(j => j.id === selectedJobId);
  const pkg = buildPackage(profile, selectedJob, includeMamba ? mambaSnapshot : null);
  const isProfileValid = profile.name.trim() && profile.title.trim() && profile.bio.trim();

  const handleAddSkill = useCallback(() => {
    const skill = skillInput.trim();
    if (skill && !profile.skills.includes(skill)) {
      setProfile(p => ({ ...p, skills: [...p.skills, skill] }));
    }
    setSkillInput('');
  }, [skillInput, profile.skills]);

  const handleRemoveSkill = useCallback((skill: string) => {
    setProfile(p => ({ ...p, skills: p.skills.filter(s => s !== skill) }));
  }, []);

  const handleResumeFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === 'string') {
        setProfile(p => ({ ...p, resumeMarkdown: text }));
      }
    };
    reader.readAsText(file);
    // Reset so the same file can be re-uploaded if needed
    e.target.value = '';
  }, []);

  const handleDownload = useCallback(() => {
    const json = JSON.stringify(pkg, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${profile.name.replace(/\s+/g, '-').toLowerCase() || 'agent'}-package.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [pkg, profile.name]);

  const handleDownloadResume = useCallback(() => {
    if (!profile.resumeMarkdown) return;
    const blob = new Blob([profile.resumeMarkdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${profile.name.replace(/\s+/g, '-').toLowerCase() || 'agent'}-resume.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [profile.resumeMarkdown, profile.name]);

  const tp = useTranslations('agentPublish');

  // Editing the profile or switching the source job invalidates a prior pass —
  // the user must re-validate the actual candidate before the publish gate opens.
  useEffect(() => {
    setValidation(null);
  }, [profile.name, profile.title, profile.bio, profile.skills, selectedJobId]);

  const handleValidate = useCallback(async () => {
    if (!isProfileValid) return;
    setIsValidating(true);
    try {
      const result = await validateAgent({
        name: profile.name,
        title: profile.title,
        bio: profile.bio,
        skills: profile.skills,
        base_model: selectedJob?.base_model ?? '',
        r2_artifact_key: selectedJob?.r2_artifact_key,
        mamba_state: includeMamba ? mambaSnapshot ?? undefined : undefined,
      });
      setValidation(result);
    } catch (e) {
      setValidation({ ok: false, error: e instanceof Error ? e.message : 'Validation failed' });
    } finally {
      setIsValidating(false);
    }
  }, [isProfileValid, profile, selectedJob, includeMamba, mambaSnapshot]);

  const handlePublish = useCallback(async () => {
    if (!isProfileValid) return;
    setIsPublishing(true);
    setPublishError(null);
    try {
      const agent = await publishAgent({
        project_id: projectId,
        job_id: selectedJob?.id,
        name: profile.name,
        title: profile.title,
        bio: profile.bio,
        skills: profile.skills,
        base_model: selectedJob?.base_model ?? '',
        lora_rank: selectedJob?.lora_rank,
        r2_artifact_key: selectedJob?.r2_artifact_key,
        resume_md: profile.resumeMarkdown || undefined,
      });
      setPublishedId(agent.id);
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : 'Publish failed');
    } finally {
      setIsPublishing(false);
    }
  }, [isProfileValid, projectId, selectedJob, profile]);

  const handleCopyInstall = useCallback(() => {
    navigator.clipboard.writeText(INSTALL_COMMAND).then(() => {
      setCopiedInstall(true);
      setTimeout(() => setCopiedInstall(false), 2000);
    });
  }, []);

  return (
    <div className="h-full flex flex-col bg-gray-900 text-white text-sm">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-700 flex items-center gap-2 shrink-0">
        <span>🚀</span>
        <h2 className="font-semibold text-gray-300">{tp('title')}</h2>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-700 shrink-0">
        {(['profile', 'download', 'publish'] as PanelTab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-xs capitalize ${tab === t ? 'bg-gray-800 text-white border-t-2 border-t-blue-500' : 'text-gray-400 hover:text-white'}`}
          >
            {t === 'profile' ? `👤 ${tp('tabProfile')}` : t === 'download' ? `⬇ ${tp('tabDownload')}` : `🌐 ${tp('tabPublish')}`}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Profile Tab */}
        {tab === 'profile' && (
          <div className="p-3 space-y-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">{tp('nameLabel')}</label>
              <input
                type="text"
                value={profile.name}
                onChange={e => setProfile(p => ({ ...p, name: e.target.value }))}
                placeholder={tp('namePlaceholder')}
                className="w-full bg-gray-800 text-white text-xs rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">{tp('titleLabel')}</label>
              <input
                type="text"
                value={profile.title}
                onChange={e => setProfile(p => ({ ...p, title: e.target.value }))}
                placeholder={tp('titlePlaceholder')}
                className="w-full bg-gray-800 text-white text-xs rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">{tp('bioLabel')}</label>
              <textarea
                value={profile.bio}
                onChange={e => setProfile(p => ({ ...p, bio: e.target.value }))}
                placeholder={tp('bioPlaceholder')}
                rows={3}
                className="w-full bg-gray-800 text-white text-xs rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none resize-none"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">{tp('tagsLabel')}</label>
              <div className="flex gap-1 mb-1.5 flex-wrap">
                {profile.skills.map(s => (
                  <span
                    key={s}
                    className="flex items-center gap-1 bg-blue-900 text-blue-200 text-xs px-1.5 py-0.5 rounded"
                  >
                    {s}
                    <button
                      onClick={() => handleRemoveSkill(s)}
                      className="text-blue-400 hover:text-white leading-none"
                      aria-label={tp('removeTag', { tag: s })}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={skillInput}
                  onChange={e => setSkillInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddSkill(); } }}
                  placeholder={tp('tagPlaceholder')}
                  className="flex-1 bg-gray-800 text-white text-xs rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none"
                />
                <button
                  onClick={handleAddSkill}
                  disabled={!skillInput.trim()}
                  className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white text-xs px-2 py-1.5 rounded"
                >
                  +
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-gray-400">{tp('resumeLabel')}</label>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  {tp('resumeUpload')}
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.txt,.pdf"
                onChange={handleResumeFileUpload}
                className="hidden"
              />
              <textarea
                value={profile.resumeMarkdown}
                onChange={e => setProfile(p => ({ ...p, resumeMarkdown: e.target.value }))}
                placeholder={tp('resumePlaceholder')}
                rows={6}
                className="w-full bg-gray-800 text-white text-xs rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none resize-none font-mono"
              />
            </div>

            {/* Associated training job */}
            {completedJobs.length > 0 && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">{tp('associatedModel')}</label>
                <Select
                  value={selectedJobId}
                  onChange={e => setSelectedJobId(e.target.value)}
                  className="w-full bg-gray-800 text-white text-xs rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none"
                >
                  <option value="">{tp('noModelSelected')}</option>
                  {completedJobs.map(j => (
                    <option key={j.id} value={j.id}>
                      {j.base_model} (rank={j.lora_rank})
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
        )}

        {/* Download Tab */}
        {tab === 'download' && (
          <div className="p-3 space-y-3">
            <p className="text-xs text-gray-400">
              {tp('downloadIntro')}
            </p>
            {/* Mamba memory toggle */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIncludeMamba(m => !m)}
                className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded border transition-colors ${
                  includeMamba
                    ? 'bg-purple-900/40 border-purple-600 text-purple-300'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                }`}
              >
                <span>🧬</span>
                {includeMamba ? tp('memoryIncluded') : tp('includeMemory')}
              </button>
              {includeMamba && mambaSnapshot && (
                <span className="text-xs text-gray-500">{tp('stepLabel', { step: mambaSnapshot.step })}</span>
              )}
              {includeMamba && !mambaSnapshot && (
                <span className="text-xs text-gray-500">{tp('noStateFound')}</span>
              )}
            </div>
            {!isProfileValid ? (
              <div className="bg-yellow-900/30 border border-yellow-700 rounded p-2 text-xs text-yellow-300">
                ⚠ {tp('fillProfileDownload')}
              </div>
            ) : (
              <>
                <div className="bg-gray-950 rounded p-2 h-52 overflow-y-auto font-mono text-xs text-green-300 whitespace-pre">
                  {JSON.stringify(pkg, null, 2)}
                </div>
                <button
                  onClick={handleDownload}
                  className="w-full bg-blue-700 hover:bg-blue-600 text-white px-3 py-2 rounded text-xs font-semibold"
                >
                  ⬇ {tp('downloadPackage')}
                </button>
                {profile.resumeMarkdown && (
                  <button
                    onClick={handleDownloadResume}
                    className="w-full bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded text-xs"
                  >
                    ⬇ {tp('downloadResume')}
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* Publish Tab */}
        {tab === 'publish' && (
          <div className="p-3 space-y-3">
            {publishedId ? (
              <div className="space-y-2">
                <div className="bg-green-900/30 border border-green-700 rounded p-3 text-xs text-green-300">
                  ✅ {tp('publishedSuccess')}
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-1">{tp('agentId')}</div>
                  <div className="bg-gray-800 rounded p-2 font-mono text-xs text-gray-300 break-all">
                    {publishedId}
                  </div>
                </div>

                {/* Install command */}
                <div>
                  <div className="text-xs text-gray-400 mb-1">📦 {tp('installCommand')}</div>
                  <div className="bg-gray-950 border border-gray-700 rounded p-2 flex items-center gap-2">
                    <code className="flex-1 font-mono text-xs text-green-300 break-all select-all">
                      {INSTALL_COMMAND}
                    </code>
                    <button
                      onClick={handleCopyInstall}
                      className="shrink-0 bg-gray-700 hover:bg-gray-600 text-white text-xs px-2 py-1 rounded"
                      title={tp('copyTitle')}
                    >
                      {copiedInstall ? `✓ ${tp('copied')}` : tp('copy')}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {tp('installHint')}
                  </p>
                </div>

                {/* How to call the just-published model (OpenAI standard + dedicated endpoint). */}
                <div>
                  <div className="text-xs text-gray-400 mb-1">{tp('callTitle')}</div>
                  <ModelApiSamples agentId={publishedId} modelRef={`builderforce/workforce-${publishedId}`} />
                </div>

                {/* Ground the agent in proprietary knowledge — ingested, then
                    recalled (BM25) and injected at inference. */}
                <div>
                  <div className="text-xs text-gray-400 mb-1">{tp('knowledgeTitle')}</div>
                  <p className="text-xs text-gray-500 mb-2">{tp('knowledgeDesc')}</p>
                  <textarea
                    value={knowledgeText}
                    onChange={(e) => setKnowledgeText(e.target.value)}
                    placeholder={tp('knowledgePlaceholder')}
                    rows={5}
                    className="w-full bg-gray-950 border border-gray-700 rounded p-2 font-mono text-xs text-gray-100"
                    aria-label={tp('knowledgeTitle')}
                  />
                  <button
                    onClick={handleIngestKnowledge}
                    disabled={isIngesting || !knowledgeText.trim()}
                    className="mt-2 w-full bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white px-3 py-2 rounded text-xs font-semibold"
                  >
                    {isIngesting ? tp('knowledgeIngesting') : tp('knowledgeBtn')}
                  </button>
                  {ingestResult && (
                    <div className="mt-2 bg-green-900/30 border border-green-700 rounded p-2 text-xs text-green-300">
                      {tp('knowledgeDone', { count: ingestResult.chunks })}
                    </div>
                  )}
                  {ingestError && (
                    <div className="mt-2 bg-red-900/30 border border-red-700 rounded p-2 text-xs text-red-300">
                      {tp('knowledgeError', { error: ingestError })}
                    </div>
                  )}
                </div>

                <a
                  href="/workforce"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full text-center bg-purple-700 hover:bg-purple-600 text-white px-3 py-2 rounded text-xs font-semibold"
                >
                  🌐 {tp('viewInRegistry')}
                </a>
                <button
                  onClick={() => { setPublishedId(null); setTab('profile'); }}
                  className="w-full bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded text-xs"
                >
                  {tp('publishAnother')}
                </button>
              </div>
            ) : (
              <>
                <p className="text-xs text-gray-400">
                  {tp('publishIntro')}
                </p>
                {!isProfileValid && (
                  <div className="bg-yellow-900/30 border border-yellow-700 rounded p-2 text-xs text-yellow-300">
                    ⚠ {tp('fillProfilePublish')}
                  </div>
                )}
                {isProfileValid && (
                  <div className="bg-gray-800 rounded p-2 space-y-1 text-xs">
                    <div className="text-gray-300 font-medium">{profile.name}</div>
                    <div className="text-gray-400">{profile.title}</div>
                    <div className="text-gray-500 line-clamp-2">{profile.bio}</div>
                    {profile.skills.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {profile.skills.map(s => (
                          <span key={s} className="bg-blue-900 text-blue-200 px-1.5 py-0.5 rounded text-xs">{s}</span>
                        ))}
                      </div>
                    )}
                    {selectedJob && (
                      <div className="text-gray-500 pt-1">
                        {tp('modelSummary', { model: selectedJob.base_model, rank: selectedJob.lora_rank ?? '' })}
                      </div>
                    )}
                  </div>
                )}
                {/* Validate-via-API gate — call the candidate model before publishing. */}
                {isProfileValid && (
                  <div className="bg-gray-800 rounded p-2 space-y-2">
                    <div className="text-xs text-gray-300 font-medium">{tp('validateTitle')}</div>
                    <div className="text-xs text-gray-500">{tp('validateDesc')}</div>
                    <button
                      onClick={handleValidate}
                      disabled={isValidating}
                      className="w-full bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white px-3 py-2 rounded text-xs font-semibold"
                    >
                      {isValidating ? `⏳ ${tp('validating')}` : `🧪 ${tp('validateBtn')}`}
                    </button>
                    {validation?.ok && (
                      <div className="bg-green-900/30 border border-green-700 rounded p-2 text-xs text-green-300 space-y-1">
                        <div className="font-semibold">✅ {tp('validatePassed')}</div>
                        <div className="text-green-400/90">
                          {tp('modeLabel')}: {validation.inference_mode} · {tp('latencyLabel')}: {validation.latency_ms}ms
                        </div>
                        <div className="text-gray-400">{tp('sampleLabel')}:</div>
                        <div className="text-gray-300 italic line-clamp-3">“{validation.sample}”</div>
                      </div>
                    )}
                    {validation && !validation.ok && (
                      <div className="bg-red-900/30 border border-red-700 rounded p-2 text-xs text-red-300">
                        ❌ {tp('validateFailed')}: {validation.error}
                      </div>
                    )}
                  </div>
                )}
                {publishError && (
                  <div className="bg-red-900/30 border border-red-700 rounded p-2 text-xs text-red-300">
                    ❌ {publishError}
                  </div>
                )}
                {isProfileValid && !validation?.ok && (
                  <div className="text-xs text-gray-500">{tp('validateGate')}</div>
                )}
                <button
                  onClick={handlePublish}
                  disabled={isPublishing || !isProfileValid || !validation?.ok}
                  className="w-full bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white px-3 py-2 rounded text-xs font-semibold"
                >
                  {isPublishing ? `⏳ ${tp('publishing')}` : `🌐 ${tp('publishBtn')}`}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
