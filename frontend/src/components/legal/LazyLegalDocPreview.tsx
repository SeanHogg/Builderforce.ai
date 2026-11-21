import dynamic from 'next/dynamic';

/**
 * `LegalDocPreview`, loaded in the browser only — for the shell surfaces that show a
 * legal document on demand: the Terms/Privacy reader (`LegalDocModal`, reached from the
 * footer and the sidebar legal strip) and the onboarding terms screen.
 *
 * `ssr: false` changes no markup: each of those renders the preview only after the
 * document has been FETCHED in the browser (the reader also waits for a click), so no
 * server render reaches it. A static import, though, put the whole document-markdown
 * pipeline (unified, remark/rehype, KaTeX, parse5) into the root layout's SERVER graph,
 * and every route function of the Cloudflare Worker carried it. See
 * scripts/check-worker-size.mjs.
 *
 * Pages that server-render a legal document (e.g. `/legal/*`) keep importing
 * `LegalDocPreview` directly.
 */
export const LazyLegalDocPreview = dynamic(
  () => import('@/components/admin/LegalDocPreview').then((m) => m.LegalDocPreview),
  { ssr: false },
);
