import KnowledgeDocClient from './KnowledgeDocClient';

export const runtime = 'edge';

export default async function KnowledgeDocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <KnowledgeDocClient docId={id} />;
}
