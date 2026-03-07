import { IDE } from '@/components/IDE';
import type { Project, FileEntry } from '@/lib/types';

async function getProject(id: string): Promise<Project | null> {
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || 'http://localhost:8787';
  try {
    const res = await fetch(`${workerUrl}/api/projects/${id}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function getFiles(projectId: string): Promise<FileEntry[]> {
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || 'http://localhost:8787';
  try {
    const res = await fetch(`${workerUrl}/api/projects/${projectId}/files`, { cache: 'no-store' });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project, files] = await Promise.all([
    getProject(id),
    getFiles(id),
  ]);

  if (!project) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-950 text-white">
        <div className="text-center">
          <div className="text-5xl mb-4">404</div>
          <p className="text-gray-400">Project not found</p>
        </div>
      </div>
    );
  }

  return <IDE project={project} initialFiles={files} />;
}
