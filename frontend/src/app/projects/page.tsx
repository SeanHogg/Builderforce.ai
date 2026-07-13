'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useOptionalBrainContext } from '@/lib/brain';
import ProjectsContent from '@/components/ProjectsContent';

type Tab = 'projects' | 'tasks';

/**
 * Projects / Tasks — one domain page with two tabs:
 *  - Projects: the project list.
 *  - Tasks: the task board/list.
 */
export default function ProjectsTasksPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, hasTenant } = useAuth();
  const brain = useOptionalBrainContext();

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login?next=/projects');
    } else if (!hasTenant) {
      router.replace('/tenants?next=/projects');
    }
  }, [isAuthenticated, hasTenant, router]);

  const activeTab: Tab = searchParams.get('tab') === 'tasks' ? 'tasks' : 'projects';

  if (!isAuthenticated || !hasTenant) return null;

  const selectTab = (tab: Tab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === 'tasks') params.set('tab', 'tasks');
    else params.delete('tab');
    const qs = params.toString();
    router.replace(`/projects${qs ? `?${qs}` : ''}`, { scroll: false });
  };

  return (
    <>
      <div
        style={{
          padding: '20px 16px',
          maxWidth: 1200,
          margin: '0 auto',
        }}
      >
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 16 }}>Projects / Tasks</h1>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            gap: 2,
            borderBottom: '1px solid var(--border-subtle)',
            marginBottom: 24,
            overflowX: 'auto',
            paddingBottom: 2,
          }}
        >
          {[
            { id: 'projects' as Tab, label: 'Projects' },
            { id: 'tasks' as Tab, label: 'Tasks' },
          ].map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => selectTab(id)}
              style={{
                padding: '12px 18px',
                fontSize: 14,
                fontWeight: 600,
                color: activeTab === id ? 'var(--coral-bright)' : 'var(--text-secondary)',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === id ? '2px solid var(--coral-bright)' : '2px solid transparent',
                cursor: 'pointer',
                marginBottom: -1,
                whiteSpace: 'nowrap',
                minWidth: 44,
                minHeight: 44,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === 'projects' ? (
          <ProjectsContent />
        ) : (
          <div style={{ padding: '20px 0' }}>Task board not yet implemented. Go back to Projects.</div>
        )}
      </div>
    </>
  );
}