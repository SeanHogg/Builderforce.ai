import { ProjectCanvasRedirect } from './ProjectCanvasRedirect';

export const runtime = 'edge';

/**
 * A Project opens as live context in the user's most recent Creation Session.
 * Administrative project lists/details remain available from /projects.
 *
 * Server component: the route param is read here, and only the authenticated
 * lookup that decides the destination runs in the browser.
 */
export default async function ProjectPageRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectCanvasRedirect id={id ?? ''} />;
}
