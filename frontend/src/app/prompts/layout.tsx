import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';

// The prompts page is a client component; per-page metadata lives in this
// server layout so the route gets its own title/description/canonical.
export const metadata: Metadata = pageMetadata({
  title: 'Prompt Library — Community AI Prompt Templates',
  description:
    'Browse and use community prompt templates with variables for AI agents and LLMs. Copy any prompt in one click, or publish your own to share with everyone.',
  path: '/prompts',
});

export default function PromptsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
