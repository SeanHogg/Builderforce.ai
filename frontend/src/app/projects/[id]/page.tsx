'use client';

import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';

/**
 * Redirect to the new project-view orchestrator.
 * /projects/:id is now /projects : returns a per-project entry point
 */
export default function ProjectPage() {
  const params = useParams();
  const id = String(params?.id);
  return <Link replace href={`/projects/${id}/view`} />;
}