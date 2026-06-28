import { pageMetadata } from '@/lib/seo';
import KnowledgeClient from './KnowledgeClient';

export const runtime = 'edge';

export const metadata = pageMetadata({
  title: 'Knowledge & Processes',
  description:
    'Document SOPs and processes, collaborate in real time, draft with AI, and prove who has read and been trained — audit-ready evidence for SOX, TISAX and ISO 27001.',
  path: '/knowledge',
});

export default function KnowledgePage() {
  return <KnowledgeClient />;
}
