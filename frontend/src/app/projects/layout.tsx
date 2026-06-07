import type { Metadata } from 'next';
import JsonLd from '@/components/JsonLd';
import { pageMetadata } from '@/lib/seo';
import { projectsTasksSchema } from '@/lib/structured-data';

// The Projects / Tasks page is a client component, so per-page SEO metadata lives
// here in a server layout (Next.js picks up the export on the route segment).
// JSON-LD is rendered server-side too, so crawlers/LLMs see the SoftwareApplication
// + ItemList + FAQ graph even though the page itself gates behind auth.
export const metadata: Metadata = pageMetadata({
  title: 'Projects / Tasks — Organize Work & Track AI Agent Tasks | Builderforce.ai',
  description:
    'Organize work into AI project workspaces — each with a full in-browser IDE, agents, and workflows — then plan, assign, and track tasks across your agent workforce with board, table, calendar, and Gantt views, approval gates, and full observability.',
  path: '/projects',
});

export default function ProjectsTasksLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={projectsTasksSchema()} />
      {children}
    </>
  );
}
