'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { TaskMgmtContent } from '@/components/TaskMgmtContent';

/**
 * Task Mgmt page: full task list/board with project filter (like CoderClawLink).
 * Uses the same reusable TaskMgmtContent as the project details panel.
 */
export default function TaskMgmtPage() {
  const router = useRouter();
  const { isAuthenticated, hasTenant } = useAuth();

  if (!isAuthenticated) {
    router.replace('/login?next=/tasks');
    return null;
  }
  if (!hasTenant) {
    router.replace('/tenants?next=/tasks');
    return null;
  }

  return (
    <div style={{ flex: 1, color: 'var(--text-primary)' }}>
      <main className="max-w-6xl mx-auto px-4 py-5">
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 4 }}>Task Mgmt</h1>
          <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            View and manage tasks across projects. Filter by project, status, or priority. Open a project from Projects to
            scope tasks to that project.
          </p>
        </div>
        <TaskMgmtContent />
      </main>
    </div>
  );
}
