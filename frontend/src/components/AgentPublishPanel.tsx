'use client';

import { useState, useCallback, useRef } from 'react';
import type { TrainingJob, AgentProfile, AgentPackage } from '@/lib/types';
import { publishAgent } from '@/lib/api';

const INSTALL_COMMAND = 'iwr -useb https://coderclaw.ai/install.ps1 | iex';

interface AgentPublishPanelProps {
  projectId: string;
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
  job: TrainingJob | undefined
): AgentPackage {
  return {
    version: '1.0',
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
}

export function AgentPublishPanel({ projectId, completedJobs }: AgentPublishPanelProps) {
  const [tab, setTab] = useState<PanelTab>('profile');
  const [profile, setProfile] = useState<AgentProfile>(DEFAULT_PROFILE);
  const [skillInput, setSkillInput] = useState('');
  const [selectedJobId, setSelectedJobId] = useState<string>(completedJobs[0]?.id ?? '');
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishedId, setPublishedId] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [copiedInstall, setCopiedInstall] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedJob = completedJobs.find(j => j.id === selectedJobId);
  const pkg = buildPackage(profile, selectedJob);
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
        <h2 className="font-semibold text-gray-300">Publish Agent</h2>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-700 shrink-0">
        {(['profile', 'download', 'publish'] as PanelTab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-xs capitalize ${tab === t ? 'bg-gray-800 text-white border-t-2 border-t-blue-500' : 'text-gray-400 hover:text-white'}`}
          >
            {t === 'profile' ? '👤 Profile' : t === 'download' ? '⬇ Download' : '🌐 Publish'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Profile Tab */}
        {tab === 'profile' && (
          <div className="p-3 space-y-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Agent Name *</label>
              <input
                type="text"
                value={profile.name}
                onChange={e => setProfile(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Python Expert"
                className="w-full bg-gray-800 text-white text-xs rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Title / Role *</label>
              <input
                type="text"
                value={profile.title}
                onChange={e => setProfile(p => ({ ...p, title: e.target.value }))}
                placeholder="e.g. Senior Python Developer"
                className="w-full bg-gray-800 text-white text-xs rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Bio / Description *</label>
              <textarea
                value={profile.bio}
                onChange={e => setProfile(p => ({ ...p, bio: e.target.value }))}
                placeholder="Describe what this agent specializes in…"
                rows={3}
                className="w-full bg-gray-800 text-white text-xs rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none resize-none"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Skills</label>
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
                      aria-label={`Remove ${s}`}
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
                  placeholder="Add skill…"
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
                <label className="text-xs text-gray-400">Resume (Markdown)</label>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Upload .md / .txt
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
                placeholder="Paste or write your resume in Markdown, or upload a .md / .txt file above. For PDF, copy-paste the text here."
                rows={6}
                className="w-full bg-gray-800 text-white text-xs rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none resize-none font-mono"
              />
            </div>

            {/* Associated training job */}
            {completedJobs.length > 0 && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Associated Model</label>
                <select
                  value={selectedJobId}
                  onChange={e => setSelectedJobId(e.target.value)}
                  className="w-full bg-gray-800 text-white text-xs rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none"
                >
                  <option value="">— no model selected —</option>
                  {completedJobs.map(j => (
                    <option key={j.id} value={j.id}>
                      {j.base_model} (rank={j.lora_rank})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {/* Download Tab */}
        {tab === 'download' && (
          <div className="p-3 space-y-3">
            <p className="text-xs text-gray-400">
              Download your agent as a portable package. Install it in CoderClaw or any
              Builderforce-compatible platform to use your custom-trained LLM.
            </p>
            {!isProfileValid ? (
              <div className="bg-yellow-900/30 border border-yellow-700 rounded p-2 text-xs text-yellow-300">
                ⚠ Fill in the Profile tab (name, title, bio) before downloading.
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
                  ⬇ Download agent-package.json
                </button>
                {profile.resumeMarkdown && (
                  <button
                    onClick={handleDownloadResume}
                    className="w-full bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded text-xs"
                  >
                    ⬇ Download resume.md
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
                  ✅ Agent published to the Workforce Registry!
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-1">Agent ID</div>
                  <div className="bg-gray-800 rounded p-2 font-mono text-xs text-gray-300 break-all">
                    {publishedId}
                  </div>
                </div>

                {/* Install command */}
                <div>
                  <div className="text-xs text-gray-400 mb-1">📦 Install Command</div>
                  <div className="bg-gray-950 border border-gray-700 rounded p-2 flex items-center gap-2">
                    <code className="flex-1 font-mono text-xs text-green-300 break-all select-all">
                      {INSTALL_COMMAND}
                    </code>
                    <button
                      onClick={handleCopyInstall}
                      className="shrink-0 bg-gray-700 hover:bg-gray-600 text-white text-xs px-2 py-1 rounded"
                      title="Copy to clipboard"
                    >
                      {copiedInstall ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Run this in PowerShell to browse and install agents from the registry.
                  </p>
                </div>

                <a
                  href="/workforce"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full text-center bg-purple-700 hover:bg-purple-600 text-white px-3 py-2 rounded text-xs font-semibold"
                >
                  🌐 View in Workforce Registry
                </a>
                <button
                  onClick={() => { setPublishedId(null); setTab('profile'); }}
                  className="w-full bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded text-xs"
                >
                  Publish another agent
                </button>
              </div>
            ) : (
              <>
                <p className="text-xs text-gray-400">
                  Publishing registers your agent in the Builderforce Workforce Registry so
                  businesses can discover and hire it.                </p>
                {!isProfileValid && (
                  <div className="bg-yellow-900/30 border border-yellow-700 rounded p-2 text-xs text-yellow-300">
                    ⚠ Fill in the Profile tab (name, title, bio) first.
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
                        Model: {selectedJob.base_model} · rank={selectedJob.lora_rank}
                      </div>
                    )}
                  </div>
                )}
                {publishError && (
                  <div className="bg-red-900/30 border border-red-700 rounded p-2 text-xs text-red-300">
                    ❌ {publishError}
                  </div>
                )}
                <button
                  onClick={handlePublish}
                  disabled={isPublishing || !isProfileValid}
                  className="w-full bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white px-3 py-2 rounded text-xs font-semibold"
                >
                  {isPublishing ? '⏳ Publishing…' : '🌐 Publish to Workforce'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
