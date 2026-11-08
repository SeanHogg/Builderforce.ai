import type { Components } from 'react-markdown';
import { DocumentMarkdown } from '@/components/DocumentMarkdown';
import type { PublicWebsitePage } from '@/lib/publicApi';

/** Links in tenant-authored Markdown are untrusted: no SEO endorsement, no opener access. */
const TENANT_CONTENT_COMPONENTS: Components = {
  a: ({ node: _node, ...props }) => <a {...props} rel="nofollow ugc noopener noreferrer" />,
};

/**
 * A published website page: its title and Markdown body at document scale.
 * Presentational — the route fetches, this only lays out. Colours
 * come from theme tokens and the column is fluid, so it holds at 360px.
 */
export function PublishedWebsitePage({ page }: { page: PublicWebsitePage }) {
  return (
    <main
      id="main-content"
      style={{
        maxWidth: 820,
        width: '100%',
        margin: '0 auto',
        padding: 'var(--space-8, 32px) 16px',
        boxSizing: 'border-box',
        overflowWrap: 'anywhere',
        background: 'var(--bg-base)',
        color: 'var(--text-primary)',
      }}
    >
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-page-title)', margin: '0 0 24px' }}>
        {page.title}
      </h1>
      <DocumentMarkdown content={page.bodyMarkdown} components={TENANT_CONTENT_COMPONENTS} />
    </main>
  );
}
