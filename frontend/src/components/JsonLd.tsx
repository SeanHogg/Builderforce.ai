/**
 * Renders a JSON-LD structured data script tag.
 *
 * Deliberately NOT `'use client'`. The docblock claimed it was "safe to use in
 * both", but the directive made it a client module, so every server page that
 * embeds structured data — `/soc2`, the domain explainers, the blog — shipped a
 * component to the browser whose entire job is to be present in the HTML a
 * crawler reads. Without the directive it is a shared module: server pages
 * render it on the server, client components that import it still get it in
 * their bundle, and the claim in this docblock becomes true.
 */
export default function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
