/**
 * The marketplace's All view — what a bare `/marketplace` opens on.
 *
 * Before it, the storefront opened on ONE chip (Agents ▸ Built-in), so a visitor
 * saw a single narrow slice of what is for sale and had no way to see the rest
 * at once. This is one strip per family, each a short preview read by the same
 * component that family's own grid uses, ending in a "See all" that moves to it.
 *
 * The strips are DATA: a family added to `FAMILIES` gets a strip by adding a row
 * here, never a branch.
 */

import type { ComponentType } from 'react';
import { useTranslations } from 'next-intl';
import { FAMILIES, FAMILY_IDS, type FamilyId } from '@/lib/marketplaceFamilies';
import { StartupPreview } from '@/components/startups/StartupPreview';
import { BuiltinAgentsSection } from './BuiltinAgentsSection';
import { CreationsSection } from './CreationsSection';
import { TalentPreview } from './TalentPreview';

const STRIP_LIMIT = 4;

type BrowseFamily = Exclude<FamilyId, 'all'>;
type StripPreview = ComponentType<{ search: string; limit: number }>;

/** Everything built on the canvas, across every asset kind. */
function CreationsPreview({ search, limit }: { search: string; limit: number }) {
  return <CreationsSection search={search} kind="" limit={limit} />;
}

const STRIPS: Record<BrowseFamily, StripPreview> = {
  talent: TalentPreview,
  company: StartupPreview,
  agent: BuiltinAgentsSection,
  asset: CreationsPreview,
};

const STRIP_FAMILIES = FAMILY_IDS.filter((id): id is BrowseFamily => id !== 'all');

export function MarketplaceOverview({ search, onSeeAll }: { search: string; onSeeAll: (family: FamilyId) => void }) {
  const tf = useTranslations('marketplace.family');
  return (
    <div className="mp-overview">
      {STRIP_FAMILIES.map((id) => {
        const Preview = STRIPS[id];
        return (
          <section
            key={id}
            className="mp-overview__strip"
            aria-label={tf(FAMILIES[id].labelKey)}
            style={{ '--seat': `var(${FAMILIES[id].hueVar})` } as React.CSSProperties}
          >
            <header className="mp-overview__head">
              <h2 className="mp-overview__title">{tf(FAMILIES[id].labelKey)}</h2>
              <button type="button" className="mp-overview__more" onClick={() => onSeeAll(id)}>
                {tf('seeAll', { family: tf(FAMILIES[id].labelKey) })} →
              </button>
            </header>
            <Preview search={search} limit={STRIP_LIMIT} />
          </section>
        );
      })}
    </div>
  );
}
