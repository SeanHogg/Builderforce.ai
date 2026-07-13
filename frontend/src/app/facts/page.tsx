import type { Metadata } from 'next';
import FactsPageClient from './FactsPageClient';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Facts — Structured Knowledge Base',
  description: 'A structured, queryable store of facts (subject / predicate / object) for your workspace and agents.',
};

export default function FactsPage() {
  return <FactsPageClient />;
}
