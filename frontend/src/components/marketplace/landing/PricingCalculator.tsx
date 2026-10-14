import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayPackDto } from '@builderforce/interaction-contract';
import { capabilityApi } from '@/lib/capabilityApi';
import { formatCents } from '@/lib/canvasMoney';
import { estimateReplayCost, VISITOR_STOPS } from '@/lib/marketplace/replayPricing';
import type { LandingSection } from '@/lib/marketplace/listingLandings';
import { LandingStartLink } from './LandingStartLink';
import styles from './listingLanding.module.css';

type PricingSection = Extract<LandingSection, { kind: 'pricing' }>;

/**
 * Visits a month → kept recordings → free or which pack (D4). The ladder is the
 * catalog's (`capabilityApi.packs()`); until it arrives — or when it cannot be
 * read — the calculator still answers the free half and says packs are listed on
 * sign-up rather than inventing prices.
 */
export function PricingCalculator({ section }: { section: PricingSection }) {
  const tNs = useTranslations(section.ns);
  const t = (key: string, values?: Record<string, string | number>) => tNs(`pricing.${key}` as never, values as never);
  const id = useId();
  const [stop, setStop] = useState(3);
  const [packs, setPacks] = useState<ReplayPackDto[]>([]);

  useEffect(() => {
    let live = true;
    capabilityApi.packs().then((ladder) => { if (live) setPacks(ladder); }, () => { if (live) setPacks([]); });
    return () => { live = false; };
  }, []);

  const visitors = VISITOR_STOPS[stop] ?? VISITOR_STOPS[0];
  const estimate = estimateReplayCost(visitors, section.freeRecordings, packs);
  const number = (n: number) => n.toLocaleString();

  return (
    <>
      <h2 className={styles.sectionTitle}>{t('title')}</h2>
      <p className={styles.lead}>{t('lead', { free: number(section.freeRecordings) })}</p>
      <div className={styles.calc} data-testid="pricing-calculator">
        <label htmlFor={id} className={styles.figureLabel}>{t('visitorsLabel', { count: number(visitors) })}</label>
        <input
          id={id}
          className={styles.range}
          type="range"
          min={0}
          max={VISITOR_STOPS.length - 1}
          step={1}
          value={stop}
          aria-valuetext={t('visitorsLabel', { count: number(visitors) })}
          onChange={(event) => setStop(Number(event.target.value))}
        />
        <div className={styles.figures}>
          <div className={styles.figure}>
            <span className={styles.figureLabel}>{t('recordings')}</span>
            <span className={styles.figureValue}>≈ {number(estimate.recordings)}</span>
          </div>
          <div className={styles.figure}>
            <span className={styles.figureLabel}>{t('monthly')}</span>
            <span className={styles.figureValue} data-testid="pricing-cost">
              {estimate.free
                ? t('free')
                : estimate.pack
                  ? `≈ ${formatCents(estimate.totalCents, { maximumFractionDigits: 0 })}`
                  : t('packsOnSignup')}
            </span>
          </div>
        </div>
        <p className={styles.note}>
          {estimate.free
            ? t('withinFree', { free: number(section.freeRecordings) })
            : estimate.pack
              ? t('packLine', { count: estimate.packCount, units: number(estimate.pack.units) })
              : t('overFree', { over: number(estimate.overflow) })}
        </p>
        <p className={styles.note}>{t('estimateNote')}</p>
        <div className={styles.actions}>
          <LandingStartLink start={section.start} label={t('startFree')} />
        </div>
      </div>
    </>
  );
}
