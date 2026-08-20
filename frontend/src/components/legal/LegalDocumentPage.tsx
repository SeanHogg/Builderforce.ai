import { getTranslations } from 'next-intl/server';
import { CompliancePage } from './CompliancePage';
import { LegalDocPreview } from '@/components/admin/LegalDocPreview';
import { fetchLegalCurrent, legalDocHref, legalDocTitleKey, type LegalDocType } from '@/lib/legalDocs';
import { useFormat } from "@/i18n/useFormat";

/**
 * The public page for a published legal instrument (Terms, Privacy).
 *
 * Server-rendered on purpose. The panel these documents used to live in fetched
 * them in an effect, which is fine for a reader who is already in the app and
 * useless for everyone else who needs to READ the document without running it:
 * a crawler, an archive, a procurement reviewer, an OAuth provider verifying the
 * app. The body has to be in the HTML.
 *
 * Both documents render through the same `LegalDocPreview` the panel and the
 * admin editor use, so the published Markdown looks identical wherever it is
 * read, and the version + publication date shown here are the document's own —
 * never the chrome's default "last updated", which would quietly assert a
 * freshness the instrument does not have.
 */
export async function LegalDocumentPage({ type }: { type: LegalDocType }) {
    const fmt = useFormat();
  const t = await getTranslations('legal');
  const legal = await fetchLegalCurrent();
  const doc = legal?.[type] ?? null;

  const title = doc?.title?.trim() || t(legalDocTitleKey(type));
  const published = doc?.publishedAt
    ? fmt.dateWith(doc.publishedAt, { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  return (
    <CompliancePage
      title={doc?.version ? `${title} · v${doc.version}` : title}
      updated={published}
      currentHref={legalDocHref(type)}
    >
      <LegalDocPreview content={doc?.content} emptyText={t('unavailable')} />
    </CompliancePage>
  );
}

/** Shared page metadata, so both routes describe themselves the same way. */
export async function legalDocumentMetadata(type: LegalDocType) {
  const t = await getTranslations('legal');
  const title = t(legalDocTitleKey(type));
  return {
    title: `${title} · BuilderForce.ai`,
    description: t('metaDescription', { document: title }),
    alternates: { canonical: legalDocHref(type) },
  };
}
