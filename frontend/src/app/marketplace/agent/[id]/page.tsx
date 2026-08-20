import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import JsonLd from '@/components/JsonLd';
import PublicDetailLayout, {
  PublicDetailFact,
  PublicDetailFacts,
  PublicDetailSection,
} from '@/components/PublicDetailLayout';
import { formatAgentPrice } from '@/lib/agentPresentation';
import { getPublicAgent } from '@/lib/marketplaceSeo';
import { pageMetadata } from '@/lib/seo';
import { publishedAgentSchema } from '@/lib/structured-data';

/**
 * ONE published workforce agent, server-rendered, indexable.
 *
 * `GET /api/workforce/agents/:id` has been public for a long time and NOTHING
 * indexable consumed it: the marketplace opened an agent in a client panel at
 * `/marketplace?agent=<id>`, a query string that is one page of duplicate
 * content as far as a crawler is concerned. Published agents are the catalog's
 * headline product and none of them had a URL.
 *
 * ── Why HERE and not under `/agents/…` ───────────────────────────────────────
 * `/agents` is the BuilderForce Agents product microsite — `/agents/showcase`,
 * `/agents/skills/[slug]`, `/agents/integrations` — marketing pages about the
 * self-hosted gateway. A published agent is not part of that microsite; it is a
 * marketplace listing, exactly like the creation listings that already live at
 * `/marketplace/listing/[slug]`. So this follows the marketplace's own
 * `<catalog>/<kind>/<key>` convention rather than inventing a third one, and
 * `/marketplace` is already a public shell prefix so no routing change was
 * needed. Putting it at `/agents/[id]` would also have made every future static
 * child of `/agents` a potential shadow of an agent id.
 *
 * ── The OG image, plainly ────────────────────────────────────────────────────
 * No per-agent rendered social card exists and none can: `next/og` returns an
 * empty 0-byte PNG on the Cloudflare edge runtime, so a generated card would
 * make unfurls fall back to a stale cached preview — worse than the static
 * branded one. See `lib/seo.ts`. The per-entity card is complete per-entity
 * METADATA plus JSON-LD (including the real `offers` price) over one static
 * branded image.
 */
export const runtime = 'edge';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const agent = await getPublicAgent(decodeURIComponent(id));
  const t = await getTranslations('agentDetail');
  if (!agent) return { title: t('notFoundTitle'), robots: { index: false, follow: false } };

  const description = (agent.bio || agent.title).slice(0, 200)
    || t('metaFallback', { name: agent.name });
  return {
    ...pageMetadata({
      title: t('metaTitle', { name: agent.name }),
      description,
      path: `/marketplace/agent/${agent.id}`,
      ogTitle: agent.name,
    }),
    ...(agent.skills.length ? { keywords: agent.skills } : {}),
  };
}

export default async function PublishedAgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const agent = await getPublicAgent(decodeURIComponent(id));
  if (!agent) notFound();
  const t = await getTranslations('agentDetail');

  // `formatAgentPrice` is the ONE price rule in the product; only the free case
  // needs localizing, because that is the only branch that is a word.
  const price = agent.priceCents
    ? formatAgentPrice({
        price_cents: agent.priceCents,
        pricing_model: agent.pricingModel === 'consumption' ? 'consumption' : 'flat_fee',
        price_unit: agent.priceUnit,
      })
    : t('free');

  return (
    <>
      <JsonLd data={publishedAgentSchema(agent)} />
      <PublicDetailLayout
        eyebrow={t('eyebrow')}
        title={agent.name}
        lede={agent.bio || agent.title}
        tags={agent.skills}
        meta={[
          agent.title,
          price,
          typeof agent.hireCount === 'number' ? t('hires', { count: agent.hireCount }) : null,
          typeof agent.evalScore === 'number'
            ? t('evalScore', { score: Math.round(agent.evalScore * 100) })
            : null,
        ]}
        actions={
          <>
            {/* The CTA is a LINK to the one buying surface, not a hire button
                here. `/workforce/hire` owns auth (`useRequireAuth`) and, for a
                priced agent, the checkout that `POST /hire` refuses without —
                so a local button would have worked for free agents and 402'd
                for exactly the ones worth selling. This page's job is to be
                found; that page's job is to sell. */}
            <Link className="pdl-btn pdl-btn-primary" href={`/workforce/hire?agent=${encodeURIComponent(agent.id)}`}>
              {t('hireCta')}
            </Link>
            <Link className="pdl-btn pdl-btn-ghost" href="/marketplace">{t('browseCta')}</Link>
          </>
        }
      >
        <PublicDetailSection heading={t('detailsHeading')}>
          <PublicDetailFacts>
            <PublicDetailFact label={t('priceLabel')}>{price}</PublicDetailFact>
            {agent.baseModel ? (
              <PublicDetailFact label={t('baseModelLabel')}>{agent.baseModel}</PublicDetailFact>
            ) : null}
            {agent.runtimeSupport ? (
              <PublicDetailFact label={t('runtimeLabel')}>{agent.runtimeSupport}</PublicDetailFact>
            ) : null}
            {agent.skills.length ? (
              <PublicDetailFact label={t('skillsLabel')}>{agent.skills.join(', ')}</PublicDetailFact>
            ) : null}
          </PublicDetailFacts>
        </PublicDetailSection>

        <p style={{ marginTop: 28 }}>
          <Link className="pdl-back" href="/marketplace">{t('back')}</Link>
        </p>
      </PublicDetailLayout>
    </>
  );
}
