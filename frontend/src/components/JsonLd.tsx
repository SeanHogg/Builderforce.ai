'use client';

/**
 * Renders a JSON-LD structured data script tag.
 * Safe to use in both server and client components.
 */
export default function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
