// No `'use client'`: this renders only inside `EmbeddedCapabilities`, which
// already declares the boundary, so the directive would add a second boundary
// marker for a component that can never be reached from a server tree.
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { GuestSignupCta } from '@/components/GuestSignupCta';
import { Badge } from '@/components/ui/Badge';
import { useAuth } from '@/lib/AuthContext';
import {
  EMBEDDED_CAPABILITIES,
  EMBEDDED_REPLACED_TOOLS,
  EMBEDDED_STACK_BENCHMARK_MONTHLY,
} from '@/lib/embeddedCapabilities';
import styles from './EmbeddedStackValue.module.css';

/**
 * The SELL half of `/embedded`.
 *
 * The page was written as a console: a catalog of thirteen switches, an install
 * snippet and a consent log. That is the right surface for an owner who has
 * already bought the argument, and it is the entire surface a VISITOR got — on a
 * public, indexed marketing route whose hero led with "0/13 capabilities active".
 * The one product in the company whose whole promise is *take an idea and help
 * someone sell it* was not selling its own.
 *
 * So this is the argument, in the order a buyer asks for it:
 *
 *   1. **The number.** Thirteen capabilities against the stack of point tools
 *      they displace — sourced from the capability registry, so it cannot drift
 *      from the catalog rendered directly beneath it.
 *   2. **Why one script beats thirteen contracts.** Install, governance,
 *      ownership.
 *   3. **The loop.** Build it in Canvas → embed it on your customers' sites →
 *      list it in the Marketplace. This is the thesis: the embedded capability
 *      is not a feature bundle, it is the distribution channel for the thing you
 *      made.
 *
 * ## Why it decides its own visibility
 *
 * It sells until it has been bought, then gets out of the way: a workspace with a
 * capability already live has made the decision, and an owner turning a
 * fourteenth switch on does not need the pitch above their controls. `null`
 * means no workspace has resolved — the signed-out page render and the
 * workspace-less session — which is exactly the audience for it.
 *
 * `activeCount` is passed rather than fetched because the parent already holds
 * `/api/embed/config`; fetching it again here would be a second tenant-scoped
 * round trip per render for a number that is already in memory. It is DATA the
 * owner has, not a `canSee` boolean the caller computed for us.
 */
export function EmbeddedStackValue({ activeCount, onShowInstall }: {
  activeCount: number | null;
  /** Step 2 of the loop is the Install view of THIS page, which is a tab rather
   *  than a URL — so the owner of the tab state hands over the transition. */
  onShowInstall: () => void;
}) {
  const t = useTranslations('embedded.sell');
  const format = useFormatter();
  const { tenantToken } = useAuth();

  if (activeCount !== null && activeCount > 0) return null;

  const money = (value: number) => format.number(value, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
  const stats = [
    { key: 'capabilities', value: String(EMBEDDED_CAPABILITIES.length) },
    { key: 'script', value: '1' },
    { key: 'stack', value: money(EMBEDDED_STACK_BENCHMARK_MONTHLY) },
    { key: 'yearly', value: money(EMBEDDED_STACK_BENCHMARK_MONTHLY * 12) },
  ] as const;
  const pillars = ['install', 'govern', 'own'] as const;
  const steps: readonly { key: string; href?: string }[] = [
    { key: 'build', href: '/create' },
    { key: 'embed' },
    { key: 'sell', href: '/marketplace' },
  ];

  return (
    <section className={styles.sell} aria-label={t('label')}>
      <div className={styles.lead}>
        <h2>{t('title')}</h2>
        <p>{t('description')}</p>
      </div>

      <div className={styles.stats}>
        {stats.map((stat) => (
          <div className={styles.stat} key={stat.key}>
            <strong>{stat.value}</strong>
            <span>{t(`stats.${stat.key}`)}</span>
          </div>
        ))}
      </div>

      <div className={styles.tools}>
        <span className={styles.toolsLabel}>{t('replacesLabel')}</span>
        <div className={styles.toolChips}>
          {EMBEDDED_REPLACED_TOOLS.map((tool) => <Badge key={tool}>{tool}</Badge>)}
        </div>
        {/* The figures are published entry-tier list prices for comparable point
            tools, not quotes — so the page says that where the number is, rather
            than in a footer nobody scrolls to. */}
        <p className={styles.disclaimer}>{t('benchmarkNote')}</p>
      </div>

      <div className={styles.pillars}>
        {pillars.map((pillar) => (
          <article className={styles.pillar} key={pillar}>
            <h3>{t(`pillars.${pillar}.title`)}</h3>
            <p>{t(`pillars.${pillar}.body`)}</p>
          </article>
        ))}
      </div>

      <div className={styles.loop}>
        <h3>{t('loop.title')}</h3>
        <p className={styles.loopLead}>{t('loop.description')}</p>
        <ol className={styles.steps}>
          {steps.map((step, index) => (
            <li className={styles.step} key={step.key}>
              <span className={styles.stepIndex} aria-hidden="true">{index + 1}</span>
              <div>
                <h4>{t(`loop.steps.${step.key}.title`)}</h4>
                <p>{t(`loop.steps.${step.key}.body`)}</p>
                {step.href
                  ? <Link className={styles.stepLink} href={step.href}>
                      {t(`loop.steps.${step.key}.action`)} <span aria-hidden="true">→</span>
                    </Link>
                  : <button type="button" className={styles.stepLink} onClick={onShowInstall}>
                      {t(`loop.steps.${step.key}.action`)} <span aria-hidden="true">→</span>
                    </button>}
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* THE guest conversion primitive, not a hand-written button pair — and it
          decides for itself that a signed-in visitor gets nothing. */}
      <GuestSignupCta
        prompt={tenantToken ? null : { next: '/embedded' }}
        title={t('cta.title')}
        body={t('cta.body')}
      />
    </section>
  );
}
