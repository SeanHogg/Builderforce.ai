import type { CSSProperties } from 'react';
import {
  masterResumeRevision,
  type CanvasResumeFamily,
  type ResumeTemplateId,
} from '@/lib/canvasResume';
import { RESUME_DOCUMENT_STYLES, renderCanvasResumeRevision, resumePageCss } from '@/lib/canvasResumeRenderer';

/**
 * One résumé, rendered as the document it is.
 *
 * ── WHY ONE COMPONENT ────────────────────────────────────────────────────────────
 * A résumé is shown in four places — the owner's profile editor, a visitor's view of
 * a talent profile, a public share link, and the canvas preview. Before this, only the
 * canvas could render one and the profile embedded an iframe from hired.video, so
 * "what my résumé looks like" had two different answers depending on who was asking.
 * Every surface now renders through this, which is what makes the preview in the
 * editor a promise about what an employer sees rather than an approximation.
 *
 * The DOCUMENT keeps its own palette — a résumé is paper, and its template's
 * accent/paper/ink are the author's choice. Everything AROUND it is our UI, so the
 * desk it sits on follows the viewer's theme through tokens.
 *
 * ── AND WHY IT IS NOT A CLIENT COMPONENT ─────────────────────────────────────────
 * Deliberately no `'use client'`: there is no state, no handler and no browser API
 * here, only props in and paper out. Its three interactive hosts are client
 * components already and pull it into their bundle by importing it, so the directive
 * bought them nothing — while {@link PublicResumeView}, an async Server Component
 * serving the public share link, was forced to ship a client bundle to render a
 * document that cannot change. That page is the one that most wants to be static.
 */
export function ResumeDocumentView({
  family,
  templateId,
  framed = true,
  maxWidth,
}: {
  family: CanvasResumeFamily;
  /** Preview a design without committing it — the style picker passes the hovered id. */
  templateId?: ResumeTemplateId;
  /** False when the host already supplies the surrounding surface (an embed). */
  framed?: boolean;
  maxWidth?: number | string;
}) {
  // The MASTER revision is what everything outside the editor means by "their résumé".
  const revision = masterResumeRevision(family);
  const rendered = renderCanvasResumeRevision({
    ...revision,
    templateId: templateId ?? revision.templateId ?? family.defaultTemplateId,
  });

  const surround: CSSProperties = framed
    ? {
        padding: 'clamp(8px, 2vw, 20px)',
        background: 'var(--bg-base)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
      }
    : { padding: 0, background: 'transparent' };

  return (
    // The document is fixed-width paper; a narrow viewport scrolls it rather than
    // letting it push the page sideways.
    <div style={{ ...surround, overflowX: 'auto', maxWidth: '100%' }}>
      <style>{`${resumePageCss(rendered.revision)}${RESUME_DOCUMENT_STYLES}`}</style>
      <div
        style={{ margin: '0 auto', maxWidth: maxWidth ?? '100%', boxShadow: framed ? 'var(--shadow-lg)' : 'none' }}
        dangerouslySetInnerHTML={{ __html: rendered.html }}
      />
    </div>
  );
}
