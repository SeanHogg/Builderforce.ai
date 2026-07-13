'use client';

import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import { persistLastProjectId } from '@/lib/auth';

/**
 * Project listing page.
 * Redirects to the IDE entry point for the selected project.
 * (Scoped to a single project via the [id] route param)
 */
export default function ProjectPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = String(params.id);

  const { isAuthenticated } = useAuth();
  const { currentProject, setProject } = useProjectScope();

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace(`/login?next=${encodeURIComponent(`/projects/${projectId}`)}`);
      return;
    }

    // Store the selected project in global scope
    if (currentProject?.id !== Number(projectId)) {
      setProject(Number(projectId));
    }

    persistLastProjectId(projectId);
    router.push(`/ide/dashboard`);
  }, [isAuthenticated, currentProject, projectId, router, setProject]);

  return <div>Redirecting to IDE dashboard...</div>;
}