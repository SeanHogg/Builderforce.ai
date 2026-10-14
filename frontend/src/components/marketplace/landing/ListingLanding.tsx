'use client';

import type { ComponentType } from 'react';
import type { LandingSection } from '@/lib/marketplace/listingLandings';
import { LANDING_SECTION_COMPONENTS } from './landingSections';
import styles from './listingLanding.module.css';

/**
 * A listing's landing (PRD 33 §4.2 step 1): its `LISTING_LANDINGS` sections, in
 * order, each drawn by the registry. The page looks the landing up once and
 * renders this above `ListingLaunch`; a listing without one renders nothing here.
 */
export function ListingLanding({ sections }: { sections: ReadonlyArray<LandingSection> | null }) {
  if (!sections || sections.length === 0) return null;
  return (
    <div className={styles.landing} data-testid="listing-landing">
      {sections.map((section, index) => {
        const Section = LANDING_SECTION_COMPONENTS[section.kind] as ComponentType<{ section: LandingSection }>;
        return (
          <section key={`${section.kind}-${index}`} className={styles.section} data-section={section.kind}>
            <Section section={section} />
          </section>
        );
      })}
    </div>
  );
}
