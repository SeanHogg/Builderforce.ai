/**
 * The storefront sections that render from the shared search box alone — one
 * table, so a new category is a ROW here rather than another arm of the page's
 * section ternary.
 *
 * Every entry is loaded on demand. A visitor sees one section at a time, and
 * each of these drags its own client stack (the bid/proposal flow, the knowledge
 * checkout, the template gallery) — none of which belongs in the eager closure
 * of a page whose default view is the agents grid.
 *
 * `gigs` and `jobs` are the SAME module: applying to a full-time role and bidding
 * on a gig are one act (a proposal on a posting), so Jobs is the find-work board
 * locked to the `fte` engagement shape — the `listJobs()` read, narrowed by the
 * same server-side filter spec a job alert uses — not a second browse-and-apply
 * surface that would drift from the first.
 */

import dynamic from 'next/dynamic';
import { createElement, type ComponentType } from 'react';
import { SkeletonGrid } from './SkeletonGrid';

/** What every section in this table is handed. */
export interface SearchSectionProps {
  search: string;
}

const loading = () => <SkeletonGrid count={6} />;

const GigsSection = dynamic(() => import('./MarketplaceGigsSection'), { loading });

const JobsSection = dynamic(
  () => import('./MarketplaceGigsSection').then((m) => {
    const Board = m.default;
    function MarketplaceJobsSection({ search }: SearchSectionProps) {
      return <Board search={search} engagement="fte" />;
    }
    return MarketplaceJobsSection;
  }),
  { loading },
);

// Knowledge and the template gallery take `search` as OPTIONAL (each also stands
// alone elsewhere). Each is adapted to this table's contract — `search` always
// handed down — so every row is a `ComponentType<SearchSectionProps>` by
// construction rather than by a cast.
const KnowledgeSection = dynamic(
  () => import('./KnowledgeMarketSection').then((m) => {
    const Market = m.KnowledgeMarketSection;
    function KnowledgeSearchSection({ search }: SearchSectionProps) {
      return <Market search={search} />;
    }
    return KnowledgeSearchSection;
  }),
  { loading },
);

// The SAME gallery `/templates` renders, reading the SAME catalogue the
// starting-point picker reads. A template listed here and a template offered in
// the prompt bar are one row, not two lists that agree by accident.
const TemplatesSection = dynamic(
  () => import('@/components/templates/TemplateGallery').then((m) => {
    const Gallery = m.TemplateGallery;
    function TemplatesSearchSection({ search }: SearchSectionProps) {
      return <Gallery search={search} />;
    }
    return TemplatesSearchSection;
  }),
  { loading },
);

/**
 * Section id → the component that renders it. The page looks its active
 * section up here before falling through to the sections that need more than
 * the search box (talent paging, the company directory, the creations kind).
 */
export const SEARCH_SECTIONS: Readonly<Record<string, ComponentType<SearchSectionProps>>> = {
  gigs: GigsSection,
  jobs: JobsSection,
  knowledge: KnowledgeSection,
  templates: TemplatesSection,
};

/** Whether the table owns this section id (own keys only — never `toString`). */
export function hasSearchSection(section: string): boolean {
  return Object.prototype.hasOwnProperty.call(SEARCH_SECTIONS, section);
}

/**
 * Renders the table's row for `section`, or nothing when the page renders that
 * section itself. ONE stable component, so the page never holds a component it
 * looked up during render (which would remount the section on every render).
 */
export function MarketplaceSearchSection({ section, search }: SearchSectionProps & { section: string }) {
  return hasSearchSection(section) ? createElement(SEARCH_SECTIONS[section]!, { search }) : null;
}
