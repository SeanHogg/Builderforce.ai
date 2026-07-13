'use client';

import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import { persistLastProjectId } from '@/lib/auth';

export default function ProjectPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = String(params?.id);
  const id = projectId ? Number(projectId) : undefined;

  const { isAuthenticated } = useAuth();
  const { currentProject, setProject } = useProjectScope();

  useEffect(() => {
    // Validate and set project in scope on mount
    if (id && !isNaN(id) && setProject) {
      setProject(id);
    }

    // Handle authentication redirect
    if (!isAuthenticated) {
      router.replace(`/login?next=${encodeURIComponent(`/projects/${projectId}`)}`);
      return;
    }

    persistLastProjectId(projectId);
  }, [isAuthenticated, currentProject, projectId, router, setProject, id]);

  return (
    <div>
      Redirecting to project overview...
    </div>
  );
}