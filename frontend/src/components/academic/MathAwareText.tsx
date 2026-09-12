'use client';

import { useMemo, type ReactNode } from 'react';
import { DocumentMarkdown } from '@/components/DocumentMarkdown';
import { normalizeTexDelimiters, renderTex, texRenderMode } from '@/lib/academic/mathTex';

/**
 * Authored prose that may carry mathematics — drawn as maths when it does.
 *
 * A lesson objective, a hypothesis or a note is plain text in almost every case, and
 * pays nothing for this: `texRenderMode` (`looksLikeTex` first) is a couple of regex
 * tests, and a plain string renders as exactly the `<p>` it always did. Only text
 * that actually contains TeX goes further:
 *
 *   • delimited maths inside prose → the platform's ONE markdown pipeline (KaTeX),
 *     so it renders the way the same line renders in a document or in chat;
 *   • a bare expression → MathML via `renderTex`, carrying a spoken reading a screen
 *     reader announces, with `role="math"`.
 *
 * `lead` is content drawn first inside the same block (a field label), so a caller
 * that used to write `<p><small>Label</small>{text}</p>` keeps that shape.
 */
export function MathAwareText({ text, className, lead }: { text: string; className?: string; lead?: ReactNode }) {
  const mode = texRenderMode(text);
  const expression = useMemo(() => (mode === 'expression' ? renderTex(text) : null), [mode, text]);

  if (mode === 'markdown') {
    return (
      <div className={className} data-math="markdown">
        {lead}
        <DocumentMarkdown content={normalizeTexDelimiters(text)} />
      </div>
    );
  }
  if (expression && !expression.empty) {
    return (
      <div className={className} data-math="expression">
        {lead}
        {/* MathML built by our own parser with every token escaped (see `mathTex.ts`),
            never the author's markup — which is what makes injecting it safe. */}
        <div role="math" aria-label={expression.spoken} dangerouslySetInnerHTML={{ __html: expression.mathml }} />
      </div>
    );
  }
  return <p className={className}>{lead}{text}</p>;
}
