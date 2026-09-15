import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { startupProfilePath } from '@builderforce/creation-canvas-contract';
import JsonLd from '@/components/JsonLd';
import PublicDetailLayout, { PublicDetailFact, PublicDetailFacts, PublicDetailSection } from '@/components/PublicDetailLayout';
import ExpressInterestButton from '@/components/startups/ExpressInterestButton';
import { pageMetadata } from '@/lib/seo';
import { getPublicStartup, type StartupProfile } from '@/lib/startupDirectory';

/**
 * One listed startup — `/marketplace/company/<slug>`.
 *
 * BurnRateOS's `/businesses/:slug` (948 lines of Mantine), as the fifth page on
 * `PublicDetailLayout`: the shape every public entity page shares, written once.
 * A server component so a founder's profile is indexable and served from the
 * edge cache; the one interactive thing on it — "express interest" — is a client
 * island. The reader here is always the PUBLIC tier (no session at the edge);
 * a signed-in visitor who wants the founder's contact opens the interest panel,
 * which is what the contact is for.
 */
export const runtime = 'edge';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const startup = await getPublicStartup(slug);
  const t = await getTranslations('startups.profile');
  if (!startup) return { title: t('notListed'), robots: { index: false, follow: false } };
  return {
    ...pageMetadata({
      title: t('seoTitle', { name: startup.name }),
      description: startup.tagline || startup.description.slice(0, 200) || t('seoFallback', { name: startup.name }),
      path: startupProfilePath(startup.slug),
      ogTitle: startup.name,
    }),
    openGraph: { type: 'profile', ...(startup.logoUrl ? { images: [startup.logoUrl] } : {}) },
  };
}

export default async function StartupProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const startup = await getPublicStartup(slug);
  if (!startup) notFound();
  const t = await getTranslations('startups.profile');
  const tv = await getTranslations('startups.vocab');
  const locale = await getLocale();
  const label = (group: string, value: string | null) => (value && tv.has(`${group}.${value}`) ? tv(`${group}.${value}`) : value ?? '');
  const place = [startup.city, startup.region, startup.country].filter(Boolean).join(', ');
  const money = (n: number | null) => (n == null ? null : new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n));

  return (
    <>
      <JsonLd data={organizationSchema(startup)} />
      <PublicDetailLayout
        eyebrow={t('eyebrow')}
        title={startup.name}
        icon={startup.logoUrl
          // eslint-disable-next-line @next/next/no-img-element -- a founder-supplied URL; next/image needs a known host
          ? <img src={startup.logoUrl} alt="" width={40} height={40} style={{ borderRadius: 'var(--radius-md)', objectFit: 'cover' }} />
          : <span aria-hidden>{startup.name.trim().charAt(0).toUpperCase()}</span>}
        meta={[
          ...(startup.stage ? [<span key="stage">{label('stage', startup.stage)}</span>] : []),
          ...(startup.sector ? [<span key="sector">{label('sector', startup.sector)}</span>] : []),
          ...(place ? [<span key="place">{place}</span>] : []),
          ...(startup.foundedYear ? [<span key="founded">{t('founded', { year: startup.foundedYear })}</span>] : []),
          ...(startup.isSeekingInvestment ? [<span key="raising" className="ui-badge ui-badge--success">{t('raising')}</span>] : []),
        ]}
        lede={startup.tagline || null}
        tags={startup.seeking.map((s) => label('seeking', s))}
        actions={
          <>
            {startup.acceptsInquiries && <ExpressInterestButton slug={startup.slug} name={startup.name} />}
            {startup.website && (
              <a className="ui-button ui-button--secondary" href={startup.website} target="_blank" rel="noopener noreferrer">{t('website')}</a>
            )}
            <Link className="ui-button ui-button--ghost" href="/marketplace?family=company&kind=business">{t('backToDirectory')}</Link>
          </>
        }
      >
        {startup.description && (
          <PublicDetailSection heading={t('about', { name: startup.name })} prose>
            {startup.description.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
          </PublicDetailSection>
        )}

        <PublicDetailSection heading={t('keyFacts')}>
          <PublicDetailFacts>
            <PublicDetailFact label={t('fact.stage')}>{label('stage', startup.stage) || '—'}</PublicDetailFact>
            <PublicDetailFact label={t('fact.businessStage')}>{label('businessStage', startup.businessStage) || '—'}</PublicDetailFact>
            <PublicDetailFact label={t('fact.sector')}>{label('sector', startup.sector) || '—'}</PublicDetailFact>
            <PublicDetailFact label={t('fact.team')}>{startup.headcount != null ? t('people', { count: startup.headcount }) : '—'}</PublicDetailFact>
            <PublicDetailFact label={t('fact.founders')}>{startup.foundersCount ?? '—'}</PublicDetailFact>
            <PublicDetailFact label={t('fact.totalFunding')}>{money(startup.totalFundingRaised) ?? '—'}</PublicDetailFact>
            <PublicDetailFact label={t('fact.mrr')}>{money(startup.monthlyRevenue) ?? '—'}</PublicDetailFact>
            <PublicDetailFact label={t('fact.runway')}>
              {startup.runwayHealth ? label('health', startup.runwayHealth) : t('runwayPrivate')}
            </PublicDetailFact>
          </PublicDetailFacts>
          <p style={{ margin: '12px 0 0', fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>{t('declaredNotice')}</p>
        </PublicDetailSection>

        {(startup.isSeekingInvestment || startup.openRounds.length > 0) && (
          <PublicDetailSection heading={t('raise')}>
            <PublicDetailFacts>
              {startup.fundingGoal != null && <PublicDetailFact label={t('fact.goal')}>{money(startup.fundingGoal)}</PublicDetailFact>}
              {startup.openRounds.map((round) => (
                <PublicDetailFact key={round.name} label={round.round ? label('stage', round.round) || round.round : round.name}>
                  {round.askAmount != null ? `${round.currency} ${new Intl.NumberFormat(locale).format(round.askAmount)}` : round.name}
                </PublicDetailFact>
              ))}
              <PublicDetailFact label={t('fact.interest')}>{t('interested', { count: startup.inquiryCount })}</PublicDetailFact>
            </PublicDetailFacts>
            {startup.acceptsInquiries && (
              <div style={{ marginTop: 14 }}>
                <ExpressInterestButton slug={startup.slug} name={startup.name} />
              </div>
            )}
          </PublicDetailSection>
        )}
      </PublicDetailLayout>
    </>
  );
}

/** schema.org Organization — what a search engine indexes a listed company as. */
function organizationSchema(startup: StartupProfile): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: startup.name,
    ...(startup.website ? { url: startup.website } : {}),
    ...(startup.logoUrl ? { logo: startup.logoUrl } : {}),
    ...(startup.description ? { description: startup.description } : {}),
    ...(startup.foundedYear ? { foundingDate: String(startup.foundedYear) } : {}),
    ...(startup.headcount ? { numberOfEmployees: { '@type': 'QuantitativeValue', value: startup.headcount } } : {}),
    ...(startup.city || startup.country ? { address: { '@type': 'PostalAddress', ...(startup.city ? { addressLocality: startup.city } : {}), ...(startup.country ? { addressCountry: startup.country } : {}) } } : {}),
  };
}
