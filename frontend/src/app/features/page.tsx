import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  NAV_GROUPS,
  STAGES,
  groupsForStage
} from '@/lib/navGroups';
import {
  REFERENCE_DOMAINS,
  REFERENCE_FOUNDATIONS,
  type ReferenceDestination
} from '@/lib/publicDestinations';
import { isSeat, seatHueVar } from '@/lib/seats';
import type { BurnrateDomainCopy } from '@/components/marketing/BurnrateDomainPage';
import MarketingFaq from '@/components/marketing/MarketingFaq';
import MethodologySection from '@/components/marketing/MethodologySection';
import RelatedArticles from '@/components/blog/RelatedArticles';
import { Icon } from '@/components/ui/Icon';

export const runtime = 'edge';

/**
 * `/features` — the marketing surface, and a PROJECTION of the registry
 * (PRD 21 §11.10.3).
 *
 * The layout is BurnRateOS's, ported as a *system* rather than as a page: the
 * band rhythm `wash → tint → raised → … → gradient`, the hero with
 * its overview card, the domain grid with a persona badge per card, the dashed
 * foundation cards, and the closing gradient CTA. Ninety-five marketing pages
 * were already built from those six primitives, and hand-authoring a third
 * marketing system is how a product ends up with a fourth.
 *
 * The CONTENT is Builderforce's, and none of it is written twice. Every card's
 * title, tagline, seat, hue and feature bullets come from the same array the
 * left panel and the marketing header read, and the counts in the overview card
 * are computed from it — so this page cannot advertise a capability the product
 * does not have, or count one it does not ship.
 */

/** A tick, used by every feature bullet. Inline because it is three lines and
 *  importing an icon set for one glyph is how a marketing page gains 40kB. */
function Tick({ tone }: { tone?: string }) {
  return (
    <svg
      width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"
      stroke={tone ?? 'currentColor'} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"
      className="mk-tick"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export default async function FeaturesPage() {
  const t = await getTranslations('featuresPage');
  const tb = await getTranslations('burnrateMarketing');
  const tn = await getTranslations('nav');
  const tm = await getTranslations('methodology');

  // Counted from the registry rather than typed into copy. A marketing number
  // that drifts from the product is the cheapest kind of lie to ship and the
  // most expensive to notice.
  const destinationCount = NAV_GROUPS.length;
  const leafCount = NAV_GROUPS.reduce((total, group) => total + (group.tabs?.length ?? 0), 0);
  const seatCount = new Set(NAV_GROUPS.filter((g) => isSeat(g.seat)).map((g) => g.seat)).size;

  const stats: Array<{ value: string; labelKey: string; hue: string }> = [
    { value: String(REFERENCE_DOMAINS.length), labelKey: 'stat.domains', hue: '--stage-run' },
    { value: String(seatCount), labelKey: 'stat.seats', hue: '--seat-cfo' },
    { value: String(destinationCount), labelKey: 'stat.destinations', hue: '--stage-make' },
    { value: `${leafCount}+`, labelKey: 'stat.features', hue: '--stage-measure' },
  ];

  const renderCard = (entry: ReferenceDestination, foundation: boolean) => {
    const copy = tb.raw(`domains.${entry.copyId}`) as BurnrateDomainCopy;
    const hue = `var(${seatHueVar(entry.seat)})`;
    return (
      <Link
        key={entry.id}
        href={entry.marketingHref}
        className={`mk-card${foundation ? ' mk-card--foundation' : ''}`}
        style={{ '--seat': hue } as React.CSSProperties}
      >
        <span className="mk-card__top">
          <span className="mk-card__icon" aria-hidden="true"><Icon source={entry.icon} size={22} /></span>
          <span className={`mk-badge${foundation ? '' : ' mk-badge--solid'}`}>
            {foundation ? t('foundationBadge') : entry.seat}
          </span>
        </span>
        <h3 className="mk-card__title">
          {copy.title}
          <span aria-hidden="true">→</span>
        </h3>
        <p className="mk-card__lede">{copy.description}</p>
        <span className="mk-feats">
          {copy.features.map((feature) => (
            <span key={feature.title}><Tick tone={hue} />{feature.title}</span>
          ))}
        </span>
      </Link>
    );
  };

  return (
    <main className="mk">
      {/* ── Band 1 · wash — the hero and the overview card ─────────────────── */}
      <section className="mk-band mk-band--wash">
        <div className="mk-in mk-hero">
          <div>
            <div className="mk-badges">
              <span className="mk-badge mk-badge--solid">{t('badgeAllSeats')}</span>
              <span className="mk-badge" style={{ '--seat': 'var(--stage-measure)' } as React.CSSProperties}>
                {t('badgeSystem')}
              </span>
            </div>
            <h1 className="mk-h1">
              <span className="mk-h1__grad">{t('titleLead')}</span>
              <span className="mk-h1__sub">{t('titleSub')}</span>
            </h1>
            <p className="mk-lede">{t('lede')}</p>
            <div className="mk-actions">
              <Link href="/create/new" className="mk-cta">{t('ctaCanvas')}</Link>
              <Link href="/pricing" className="mk-cta mk-cta--ghost">{t('ctaPricing')}</Link>
            </div>
            <div className="mk-checks">
              <span><Tick tone="var(--success)" />{t('check.noCard')}</span>
              <span><Tick tone="var(--success)" />{t('check.boardFirst')}</span>
              <span><Tick tone="var(--success)" />{t('check.soc2')}</span>
            </div>
          </div>
          <aside className="mk-overview">
            <p className="mk-overview__head"><span aria-hidden="true">✦</span>{t('overviewTitle')}</p>
            <div className="mk-stats">
              {stats.map((stat) => (
                <span key={stat.labelKey} className="mk-stat" style={{ '--seat': `var(${stat.hue})` } as React.CSSProperties}>
                  <b>{stat.value}</b>
                  <small>{t(stat.labelKey)}</small>
                </span>
              ))}
            </div>
            <p className="mk-overview__note">{t('overviewNote')}</p>
          </aside>
        </div>
      </section>

      {/* ── Band 2 · tint — the METHOD, before the catalogue of what it reaches ─
          It sits here, immediately under the hero, because "what is this" is
          answered by how the thing works and not by how many destinations it
          has. The page used to open onto nine domain cards, which answers a
          question nobody has yet. Rendered by the shared component so this
          page, /about, /pricing and /sell-builderforce cannot describe the same
          method four different ways. */}
      <section className="mk-band mk-band--tint">
        <div className="mk-in">
          {/* `catalog`, not `full`: band 5 below renders the arc as a table
              generated from the registry itself, and one page may not show the
              arc twice. */}
          <MethodologySection variant="catalog" />
          {/* The long form, for anyone the four cards left curious. Which posts
              is decided by RELATED_ARTICLES.methodology, never listed here. */}
          <RelatedArticles surface="methodology" embedded />
        </div>
      </section>

      {/* ── Band 3 · raised — the domains, one card per owner ───────────────── */}
      <section className="mk-band">
        <div className="mk-in">
          <header className="mk-center">
            <span className="mk-badge">{t('domainsBadge')}</span>
            <h2>{t('domainsTitle', { count: REFERENCE_DOMAINS.length })}</h2>
            <p>{t('domainsLede')}</p>
          </header>
          <div className="mk-grid">{REFERENCE_DOMAINS.map((entry) => renderCard(entry, false))}</div>
        </div>
      </section>

      {/* ── Band 4 · tint — the foundations, dashed because nobody owns them ── */}
      <section className="mk-band mk-band--tint">
        <div className="mk-in">
          <header className="mk-center">
            <span className="mk-badge" style={{ '--seat': 'var(--stage-measure)' } as React.CSSProperties}>
              {t('foundationsBadge')}
            </span>
            <h2>{t('foundationsTitle', { count: REFERENCE_FOUNDATIONS.length })}</h2>
            <p>{t('foundationsLede')}</p>
          </header>
          <div className="mk-grid mk-grid--wide">{REFERENCE_FOUNDATIONS.map((entry) => renderCard(entry, true))}</div>
        </div>
      </section>

      {/* ── Band 5 · raised — the arc, straight off the registry ────────────── */}
      <section className="mk-band">
        <div className="mk-in">
          <header className="mk-center">
            <span className="mk-badge" style={{ '--seat': 'var(--seat-manager)' } as React.CSSProperties}>
              {t('arcBadge')}
            </span>
            <h2>{t('arcTitle')}</h2>
            <p>{t('arcLede')}</p>
          </header>
          {/* Wide content scrolls inside its own container so the page body never
              scrolls sideways (PRD 21 §3.4). */}
          <div className="mk-tablewrap">
            <table className="mk-table">
              <thead>
                <tr>
                  <th scope="col">{t('arcCol.stage')}</th>
                  <th scope="col">{t('arcCol.question')}</th>
                  <th scope="col">{t('arcCol.where')}</th>
                </tr>
              </thead>
              <tbody>
                {STAGES.map((stage) => {
                  const rows = groupsForStage(NAV_GROUPS, stage).filter((g) => !g.superadminOnly);
                  if (rows.length === 0) return null;
                  return (
                    <tr key={stage}>
                      <th scope="row">
                        <span className="mk-stagedot" style={{ '--seat': `var(--stage-${stage})` } as React.CSSProperties} aria-hidden="true" />
                        {tn(`stage.${stage}`)}
                      </th>
                      {/* One home for a stage's question: the methodology
                          registry's copy, which <MethodologySection> renders on
                          the other three marketing pages. */}
                      <td>{tm(`arcQuestion.${stage}`)}</td>
                      <td>
                        <span className="mk-rowlist">
                          {rows.map((group) => (
                            <Link key={group.id} href={group.href} className="mk-rowchip" style={{ '--seat': `var(${seatHueVar(group.seat)})` } as React.CSSProperties}>
                              {tn(group.labelKey)}
                              {isSeat(group.seat) && <em>{group.seat}</em>}
                            </Link>
                          ))}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mk-note">{t('arcNote')}</p>
        </div>
      </section>

      {/* ── Band 6 · tint — the questions the merge raises ──────────────────── */}
      <section className="mk-band mk-band--tint">
        <div className="mk-in">
          <header className="mk-center"><h2>{t('faqTitle')}</h2></header>
          {/* THE marketing FAQ list. This band used to re-inline the `.mk-q`
              markup by hand against a `{q, a}` shape while `ReferencePage`
              exported its own copy against `{question, answer}` — one list, two
              declarations. The catalog keeps this page's shorthand keys, so the
              shape is mapped here rather than duplicating the component. */}
          <MarketingFaq
            items={(t.raw('faq') as Array<{ q: string; a: string }>).map((item) => ({
              question: item.q,
              answer: item.a,
            }))}
          />
        </div>
      </section>

      {/* ── Band 6 · gradient — the close. The gradient's second and last use. ─ */}
      <section className="mk-band mk-band--grad">
        <div className="mk-in">
          <h2>{t('closeTitle')}</h2>
          <p>{t('closeLede')}</p>
          <div className="mk-actions">
            <Link href="/create/new" className="mk-cta">{t('ctaCanvas')}</Link>
            <Link href="/pricing" className="mk-cta mk-cta--ghost">{t('ctaPricing')}</Link>
          </div>
          <p className="mk-fine">{t('closeFine')}</p>
        </div>
      </section>
    </main>
  );
}
