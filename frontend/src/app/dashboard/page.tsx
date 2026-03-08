'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Project } from '@/lib/types';
import { fetchProjects } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';

/**
 * Dashboard (home) — CoderClawLink-style: "What should we build?" prompt,
 * projects preview (View all → /projects), and Claws/Workforce section.
 * The full project list and create flow live on /projects.
 */
export default function DashboardPage() {
  const router = useRouter();
  const { isAuthenticated, hasTenant } = useAuth();

  const [projects, setProjects] = useState<Project[]>([]);
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
    fetchProjects()
      .then(setProjects)
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, [isAuthenticated, hasTenant]);

  const handlePromptSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = prompt.trim();
    if (!p) return;
    // TODO: wire to scaffold / "Send to Claw" (api.builderforce.ai)
    setPrompt('');
  };

  if (!isAuthenticated || !hasTenant) return null;

  const projectPreview = projects.slice(0, 6);

  return (
    <div style={{ flex: 1, background: 'var(--bg-deep)', color: 'var(--text-primary)' }}>
      <main style={{ maxWidth: 960, margin: '0 auto', padding: '40px 24px' }}>
        {/* Prompt — What should we build? */}
        <div style={{ textAlign: 'center', marginBottom: 52 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 6px' }}>
            What should we build?
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '0 0 20px' }}>
            Describe a task and Builderforce will get it done
          </p>
          <form
            onSubmit={handlePromptSubmit}
            style={{ display: 'grid', gap: 10, maxWidth: 760, margin: '0 auto' }}
          >
            <div style={{ display: 'flex', gap: 10 }}>
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Build a budget tracker with Material UI components…"
                style={{
                  flex: 1,
                  fontSize: 14,
                  padding: '10px 14px',
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 10,
                  outline: 'none',
                }}
              />
              <button
                type="submit"
                style={{
                  whiteSpace: 'nowrap',
                  padding: '10px 18px',
                  background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-display)',
                }}
              >
                Send to Claw
              </button>
            </div>
          </form>
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
            <Link href="/workforce" style={{ color: 'var(--coral-bright)', textDecoration: 'none' }}>
              Manage workforce / claws
            </Link>
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
                <Link
                  key={p.id}
                  href={`/projects/${p.id}`}
                  style={{
                    display: 'block',
                    padding: 20,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 12,
                    textDecoration: 'none',
                    color: 'inherit',
                    transition: 'border-color 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</div>
                      <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: 2 }}>
                        {String(p.id).slice(0, 8)}
                      </div>
                    </div>
                    {p.template && (
                      <span
                        style={{
                          fontSize: 11,
                          color: 'var(--text-muted)',
                          background: 'var(--surface-interactive)',
                          padding: '2px 8px',
                          borderRadius: 6,
                        }}
                      >
                        {p.template}
                      </span>
                    )}
                  </div>
                  {p.description && (
                    <div
                      style={{
                        fontSize: 13,
                        color: 'var(--text-secondary)',
                        lineHeight: 1.5,
                        marginBottom: 8,
                        overflow: 'hidden',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }}
                    >
                      {p.description}
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {p.created_at
                      ? new Date(p.created_at).toLocaleDateString()
                      : (p as { createdAt?: string }).createdAt
                        ? new Date((p as { createdAt?: string }).createdAt!).toLocaleDateString()
                        : '—'}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Claws / Workforce section */}
        <section>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
            }}
          >
            <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Claws</h2>
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
              Manage claws
            </Link>
          </div>
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
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Workforce & agents</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
              Publish and discover agents in the Workforce Registry
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
        </section>
      </main>
    </div>
  );
}
