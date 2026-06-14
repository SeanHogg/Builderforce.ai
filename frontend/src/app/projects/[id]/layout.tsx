import type { Metadata } from 'next';

// Project DETAIL pages are auth-gated and not meant to be indexed, but without
// their own metadata they would inherit the `/projects` list canonical + the
// list's SoftwareApplication/ItemList JSON-LD from the parent segment layout.
// Override per-id: a self-referential canonical and `noindex` so a detail route
// never advertises the list page's canonical or structured data. If per-project
// detail SEO is ever wanted (public, shareable projects), swap `noindex` for a
// `CreativeWork`/`Project` schema here.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return {
    alternates: { canonical: `/projects/${id}` },
    robots: { index: false, follow: false },
  };
}

export default function ProjectDetailLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
