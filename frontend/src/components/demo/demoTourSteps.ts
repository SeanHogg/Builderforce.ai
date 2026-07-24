/**
 * Demo product-tour scripts (migration 0360). Each persona's tour is an ordered
 * list of nav destinations to spotlight; the copy for each destination is generic
 * and defined ONCE (i18n `demo.tour.nav.<anchor>.*`), so the same feature reads
 * consistently across personas — the persona angle comes from which features are
 * included, their order, and the persona-specific welcome line.
 *
 * `anchor` doubles as the `data-tour` id on the sidebar / bottom-nav item AND the
 * key into TOUR_ROUTES for where to navigate. Keep anchors in sync with the nav
 * group ids (Sidebar `data-tour={group.id}`) — those are the reliable, always-
 * present DOM targets. If an anchor's element isn't on screen (e.g. a nav item
 * hidden on mobile), the tour falls back to a centered card, so a missing anchor
 * degrades gracefully rather than breaking the tour.
 */
import type { DemoPersona } from '@/lib/demoApi';

export type TourAnchor = 'dashboard' | 'projects' | 'workforce' | 'insights' | 'quality' | 'knowledge';

/** In-app route each anchor navigates to when its tour step opens. */
export const TOUR_ROUTES: Record<TourAnchor, string> = {
  dashboard: '/dashboard',
  projects: '/projects',
  workforce: '/workforce',
  insights: '/insights',
  quality: '/quality',
  knowledge: '/knowledge',
};

/**
 * The ordered feature walk per persona — chosen so each tour tells that buyer's
 * story with the highest-value surfaces first.
 */
export const PERSONA_TOUR: Record<DemoPersona, TourAnchor[]> = {
  'ai-team': ['projects', 'workforce', 'insights', 'quality'],
  insights: ['insights', 'quality', 'projects', 'workforce'],
  pmo: ['projects', 'insights', 'workforce', 'knowledge'],
  talent: ['workforce', 'projects', 'insights', 'knowledge'],
  governance: ['quality', 'projects', 'knowledge', 'insights'],
};

/** A resolved tour step. `welcome`/`finish` are centered cards; `anchor` steps spotlight a nav item. */
export type TourStep =
  | { kind: 'welcome' }
  | { kind: 'anchor'; anchor: TourAnchor }
  | { kind: 'finish' };

/** Build the full step list for a persona: welcome → feature walk → finish. */
export function buildTourSteps(persona: DemoPersona): TourStep[] {
  return [
    { kind: 'welcome' },
    ...PERSONA_TOUR[persona].map((anchor): TourStep => ({ kind: 'anchor', anchor })),
    { kind: 'finish' },
  ];
}
