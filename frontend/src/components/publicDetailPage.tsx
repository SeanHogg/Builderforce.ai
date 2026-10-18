import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import JsonLd from '@/components/JsonLd';
import PublicDetailLayout, { type PublicDetailLayoutProps } from '@/components/PublicDetailLayout';

/** The server-side translator for the entity's own namespace. */
export type DetailTranslator = Awaited<ReturnType<typeof getTranslations>>;

type Params = { params: Promise<{ slug: string }> };

export interface PublicDetailPageSpec<E> {
  /** next-intl namespace; must hold `notFoundTitle`, `eyebrow` and `back`. */
  namespace: string;
  load: (slug: string) => Promise<E | null>;
  metadata: (entity: E, t: DetailTranslator) => Metadata;
  schema: (entity: E) => Record<string, unknown>;
  /** The catalog index the trailing "back" link returns to. */
  backHref: string;
  /** Everything {@link PublicDetailLayout} takes except the eyebrow (always `t('eyebrow')`) and the body. */
  layout: (entity: E, t: DetailTranslator) => Omit<PublicDetailLayoutProps, 'eyebrow' | 'children'>;
  body: (entity: E, t: DetailTranslator) => ReactNode;
}

/**
 * The server-rendered, indexable public detail page for one catalog entity
 * (skill, persona, prompt…). The three routes were the same ~40 lines — load by
 * slug, 404 metadata, JSON-LD, {@link PublicDetailLayout}, back link — and
 * differed only in data, so that shape lives here once.
 *
 * `export const runtime = 'edge'` must stay a literal in each route file (Next
 * reads it statically), so the route re-exports `generateMetadata`/default from
 * the returned pair and declares its own runtime.
 */
export function makePublicDetailPage<E>(spec: PublicDetailPageSpec<E>) {
  async function generateMetadata({ params }: Params): Promise<Metadata> {
    const { slug } = await params;
    const entity = await spec.load(decodeURIComponent(slug));
    const t = await getTranslations(spec.namespace);
    if (!entity) return { title: t('notFoundTitle'), robots: { index: false, follow: false } };
    return spec.metadata(entity, t);
  }

  async function DetailPage({ params }: Params) {
    const { slug } = await params;
    const entity = await spec.load(decodeURIComponent(slug));
    if (!entity) notFound();
    const t = await getTranslations(spec.namespace);
    return (
      <>
        <JsonLd data={spec.schema(entity)} />
        <PublicDetailLayout eyebrow={t('eyebrow')} {...spec.layout(entity, t)}>
          {spec.body(entity, t)}
          <p style={{ marginTop: 28 }}>
            <Link className="pdl-back" href={spec.backHref}>{t('back')}</Link>
          </p>
        </PublicDetailLayout>
      </>
    );
  }

  return { generateMetadata, DetailPage };
}
