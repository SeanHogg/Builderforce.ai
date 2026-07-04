import { pageMetadata } from '@/lib/seo';
import KanbanTemplatesClient from './KanbanTemplatesClient';

export const metadata = pageMetadata({
  title: 'Kanban Templates — roles, lanes & the marketplace',
  description:
    'Build, switch, and share best-practice kanban templates. Every lane declares the roles and diagnostics required before a ticket advances — the spine of the agentic workforce board.',
  path: '/kanban-templates',
});

export default function KanbanTemplatesPage() {
  return <KanbanTemplatesClient />;
}
