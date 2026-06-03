import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';

// The marketplace page itself is a client component, so per-page metadata lives
// here in a server layout (Next.js picks up the export on the route segment).
export const metadata: Metadata = pageMetadata({
  title: 'Workforce Marketplace — Hire, Install & Publish AI Agents, Skills & Personas',
  description:
    'Browse the Builderforce.ai Workforce Registry: hire trained AI agents, install skills and personas, and publish your own. Free to browse, zero commission on what you publish.',
  path: '/marketplace',
});

export default function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
