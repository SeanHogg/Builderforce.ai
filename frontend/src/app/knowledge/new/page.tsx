import { pageMetadata } from '@/lib/seo';
import NewKnowledgeClient from './NewKnowledgeClient';

export const runtime = 'edge';

export const metadata = pageMetadata({
  title: 'New Knowledge Document',
  description: 'Start a new SOP, process, document or canvas from a template.',
  path: '/knowledge/new',
});

export default function NewKnowledgePage() {
  return <NewKnowledgeClient />;
}
