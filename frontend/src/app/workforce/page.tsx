'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { listAgents, hireAgent } from '@/lib/api';
import type { PublishedAgent } from '@/lib/types';

function SkillBadge({ skill }: { skill: string }) {
  return (
    <span className="bg-blue-900/60 text-blue-200 text-xs px-2 py-0.5 rounded-full border border-blue-800">
      {skill}
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-700 rounded-full h-1.5">
        <div
          className="bg-green-500 h-1.5 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
    </div>
  );
}

function AgentCard({
  agent,
  onHire,
  hiring,
}: {
  agent: PublishedAgent;
  onHire: (id: string) => void;
  hiring: boolean;
}) {
  const skills: string[] = Array.isArray(agent.skills)
    ? agent.skills
    : JSON.parse(typeof agent.skills === 'string' ? agent.skills : '[]');

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 flex flex-col gap-3 hover:border-gray-500 transition-colors">
      {/* Avatar + name */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg shrink-0">
          {agent.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-white truncate">{agent.name}</h3>
          <p className="text-sm text-blue-400 truncate">{agent.title}</p>
        </div>
      </div>

      {/* Bio */}
      <p className="text-sm text-gray-400 line-clamp-3">{agent.bio}</p>

      {/* Skills */}
      {skills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {skills.slice(0, 5).map(s => <SkillBadge key={s} skill={s} />)}
          {skills.length > 5 && (
            <span className="text-xs text-gray-500">+{skills.length - 5} more</span>
          )}
        </div>
      )}

      {/* Model info */}
      {agent.base_model && (
        <div className="text-xs text-gray-500 flex items-center gap-1">
          <span>🧠</span>
          <span>{agent.base_model}</span>
          {agent.lora_rank && <span>· rank={agent.lora_rank}</span>}
        </div>
      )}

      {/* Eval score */}
      {agent.eval_score != null && (
        <div>
          <div className="text-xs text-gray-500 mb-1">Quality score</div>
          <ScoreBar score={agent.eval_score} />
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-gray-800">
        <span className="text-xs text-gray-500">
          {agent.hire_count} hire{agent.hire_count !== 1 ? 's' : ''}
        </span>
        <button
          onClick={() => onHire(agent.id)}
          disabled={hiring}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg font-medium transition-colors"
        >
          {hiring ? 'Hiring…' : 'Hire Agent'}
        </button>
      </div>
    </div>
  );
}

export default function WorkforcePage() {
  const [agents, setAgents] = useState<PublishedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hiringId, setHiringId] = useState<string | null>(null);
  const [hiredId, setHiredId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    listAgents()
      .then(setAgents)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load agents'))
      .finally(() => setLoading(false));
  }, []);

  const handleHire = useCallback(async (agentId: string) => {
    setHiringId(agentId);
    try {
      const updated = await hireAgent(agentId);
      setAgents(prev => prev.map(a => a.id === agentId ? updated : a));
      setHiredId(agentId);
      setTimeout(() => setHiredId(null), 3000);
    } catch {
      // noop — keep UX clean
    } finally {
      setHiringId(null);
    }
  }, []);

  const filtered = agents.filter(a => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const skills: string[] = Array.isArray(a.skills)
      ? a.skills
      : JSON.parse(typeof a.skills === 'string' ? a.skills : '[]');
    return (
      a.name.toLowerCase().includes(q) ||
      a.title.toLowerCase().includes(q) ||
      a.bio.toLowerCase().includes(q) ||
      skills.some(s => s.toLowerCase().includes(q))
    );
  });

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Nav */}
      <nav className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-blue-400 text-2xl">⚡</span>
              <span className="text-xl font-bold">Builderforce.ai</span>
            </Link>
            <span className="text-gray-600">|</span>
            <span className="text-gray-300 font-medium">Workforce Registry</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="text-gray-400 hover:text-white text-sm transition-colors"
            >
              Dashboard
            </Link>
            <Link
              href="/register"
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Publish Your Agent
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 py-12 text-center">
        <h1 className="text-4xl font-bold mb-3">
          Hire an{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">
            AI Agent
          </span>
        </h1>
        <p className="text-gray-400 text-lg mb-8 max-w-2xl mx-auto">
          Browse custom-trained AI agents built by our community. Hire the right agent for your
          project and integrate their specialised LLM into your workflow.
        </p>

        {/* Search */}
        <div className="max-w-lg mx-auto relative">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, skill, or specialization…"
            className="w-full bg-gray-900 text-white rounded-xl px-4 py-3 pl-10 border border-gray-700 focus:border-blue-500 outline-none text-sm"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">🔍</span>
        </div>
      </section>

      {/* Hired notification */}
      {hiredId && (
        <div className="fixed top-4 right-4 bg-green-800 border border-green-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg z-50">
          ✅ Agent hired successfully!
        </div>
      )}

      {/* Content */}
      <section className="max-w-6xl mx-auto px-6 pb-16">
        {loading && (
          <div className="text-center py-20 text-gray-400">
            <div className="text-4xl mb-4 animate-pulse">🤖</div>
            Loading agents…
          </div>
        )}

        {!loading && error && (
          <div className="text-center py-20">
            <div className="text-4xl mb-4">⚠️</div>
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-20">
            <div className="text-4xl mb-4">🤖</div>
            <p className="text-gray-400 mb-2">
              {agents.length === 0
                ? 'No agents published yet.'
                : 'No agents match your search.'}
            </p>
            {agents.length === 0 && (
              <Link
                href="/register"
                className="text-blue-400 hover:text-blue-300 text-sm underline"
              >
                Be the first to publish an agent →
              </Link>
            )}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <>
            <p className="text-gray-500 text-sm mb-6">
              {filtered.length} agent{filtered.length !== 1 ? 's' : ''} available
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {filtered.map(agent => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onHire={handleHire}
                  hiring={hiringId === agent.id}
                />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
