'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Project } from '@/lib/types';
import { fetchProjects } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import { ChatInput } from '@/components/ChatInput';
import { ProjectCard } from '@/components/ProjectCard';
import { claws, type Claw } from '@/lib/builderforceApi';

/**
 * Dashboard (home) — CoderClawLink-style: "What should we build?" chat input,
 * projects preview (View all → /projects), and Workforce section with agent list.
 */
export default function DashboardPage() {
  const router = useRouter();
  const { isAuthenticated, hasTenant } = useAuth();

  const [projects, setProjects] = useState<Project[]>([]);
  const [clawList, setClawList] = useState<Claw[]>([]);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState('');

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login?next=/dashboard');
    } else if (!hasTenant) {
      router.replace('/tenants?next=/dashboard');
    }
  }, [isAuthenticated, hasTenant, router]);

  useEffect(() => {
    if (!isAuthenticated || !hasTenant) return;
    Promise.all([
      fetchProjects().catch(() => [] as Project[]),
      claws.list().catch(() => [] as Claw[]),
    ])
      .then(([projs, clawsData]) => {
        setProjects(Array.isArray(projs) ? projs : []);
        setClawList(Array.isArray(clawsData) ? clawsData : []);
      })
      .finally(() => setLoading(false));
  }, [isAuthenticated, hasTenant]);

  const handlePromptSubmit = () => {
    const p = prompt.trim();
    if (!p) return;
    // TODO: wire to scaffold / "Send to Claw" (api.builderforce.ai)
    setPrompt('');
  };

  const connectedClaws = clawList.filter((c) => c.connectedAt);

  if (!isAuthenticated || !hasTenant) return null;

  const projectPreview = projects.slice(0, 6);

  return (
    <div style={{ flex: 1, background: 'var(--bg-deep)', color: 'var(--text-primary)' }}>
      <main style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px' }}>
        {/* Prompt — What should we build? */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 6px' }}>
            What should we build?
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '0 0 20px' }}>
            Start in <Link href="/brainstorm" style={{ color: 'var(--coral-bright)', textDecoration: 'none' }}>Brain Storm</Link> to ideate, then execute as a project and build in the IDE—or assign work via <Link href="/tasks" style={{ color: 'var(--coral-bright)', textDecoration: 'none' }}>Tasks</Link> and <Link href="/workforce" style={{ color: 'var(--coral-bright)', textDecoration: 'none' }}>Workforce</Link> agents.
          </p>
          <div style={{ maxWidth: 760, margin: '0 auto' }}>
            <ChatInput
              value={prompt}
              onChange={setPrompt}
              onSubmit={handlePromptSubmit}
              placeholder="Build a budget tracker with Material UI components…"
              submitLabel="Send to Claw"
              rows={1}
              submitOnEnter={false}
              showBrainIcon={true}
              showVoice={true}
              secondaryLink={{ label: 'Manage workforce', href: '/workforce' }}
            />
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
            {connectedClaws.length > 0
              ? `${connectedClaws.length} agent${connectedClaws.length !== 1 ? 's' : ''} connected · ${connectedClaws.map((c) => c.name).join(', ')}`
              : 'No agents connected — '}
            {connectedClaws.length === 0 && (
              <Link href="/workforce" style={{ color: 'var(--coral-bright)', textDecoration: 'none' }}>
                set up in Workforce
              </Link>
            )}
          </div>
        </div>

        {/* Projects section (preview) */}
        <section style={{ marginBottom: 40 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
            }}
          >
            <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Projects</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <Link
                href="/projects"
                style={{
                  fontSize: '0.875rem',
                  color: 'var(--text-secondary)',
                  textDecoration: 'none',
                  padding: '6px 12px',
                  borderRadius: 8,
                }}
              >
                View all
              </Link>
              <Link
                href="/projects?create=1"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 14px',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 10,
                  textDecoration: 'none',
                  fontFamily: 'var(--font-display)',
                  boxShadow: '0 4px 14px var(--shadow-coral-mid)',
                }}
              >
                + New project
              </Link>
            </div>
          </div>

          {loading ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px 0' }}>Loading…</div>
          ) : projects.length === 0 ? (
            <div
              style={{
                padding: 28,
                textAlign: 'center',
                background: 'var(--bg-elevated)',
                borderRadius: 12,
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ fontSize: 48, marginBottom: 12 }}>📁</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>No projects yet</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
                Create your first project to start organizing work
              </div>
              <Link
                href="/projects?create=1"
                style={{
                  display: 'inline-block',
                  padding: '10px 20px',
                  background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                  color: '#fff',
                  borderRadius: 10,
                  fontWeight: 600,
                  textDecoration: 'none',
                  fontFamily: 'var(--font-display)',
                }}
              >
                Create project
              </Link>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
              {projectPreview.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  onCardClick={(proj) => router.push(`/projects/${proj.id}`)}
                  onDetailsClick={(proj) => router.push(`/projects/${proj.id}`)}
                  showDetailsButton
                />
              ))}
            </div>
          )}
        </section>

        {/* Workforce section */}
        <section>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
            }}
          >
            <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Workforce</h2>
            <Link
              href="/workforce"
              style={{
                fontSize: '0.875rem',
                color: 'var(--text-secondary)',
                textDecoration: 'none',
                padding: '6px 12px',
                borderRadius: 8,
              }}
            >
              Manage workforce
            </Link>
          </div>

          {loading ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px 0' }}>Loading…</div>
          ) : clawList.length === 0 ? (
            <div
              style={{
                padding: 28,
                textAlign: 'center',
                background: 'var(--bg-elevated)',
                borderRadius: 12,
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ fontSize: 48, marginBottom: 12 }}>🦀</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>No agents registered</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
                Register an agent in Workforce to start delegating work
              </div>
              <Link
                href="/workforce"
                style={{
                  display: 'inline-block',
                  padding: '10px 20px',
                  background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                  color: '#fff',
                  borderRadius: 10,
                  fontWeight: 600,
                  textDecoration: 'none',
                  fontFamily: 'var(--font-display)',
                }}
              >
                Open Workforce
              </Link>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
              {clawList.map((c) => (
                <div
                  key={c.id}
                  style={{
                    padding: 20,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 12,
                    position: 'relative',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{c.name}</div>
                      <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: 2 }}>
                        #{c.id}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: 6,
                        background: c.connectedAt ? 'rgba(34, 197, 94, 0.15)' : 'var(--bg-deep)',
                        color: c.connectedAt ? '#22c55e' : 'var(--text-muted)',
                      }}
                    >
                      {c.connectedAt ? 'Online' : 'Offline'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {c.lastSeenAt ? `Last seen ${new Date(c.lastSeenAt).toLocaleString()}` : 'Never connected'}
                  </div>
                  <Link
                    href="/workforce"
                    style={{
                      display: 'inline-block',
                      marginTop: 10,
                      fontSize: 12,
                      color: 'var(--coral-bright)',
                      textDecoration: 'none',
                    }}
                  >
                    Manage →
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
