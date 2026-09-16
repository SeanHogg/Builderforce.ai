/**
 * The dashboard verticals — which of the startup sectors carry a preconfigured
 * KPI dashboard, and how every other sector folds onto one (PRD 25 §5).
 *
 * ── WHY TEN, AND WHY THESE ───────────────────────────────────────────────────
 * Ranked by 2025–2026 venture dollars and by the industries Carta's own State of
 * Private Markets reports on: AI-native (over half of all dollars), SaaS, fintech,
 * digital health, medical devices, biopharma, climate and energy, hardware and
 * robotics including defence and aerospace, cybersecurity, and marketplaces with
 * consumer commerce. A vertical is a VALUE here, never a new pack or a new kind —
 * the same rule the operations vocabulary applies to disciplines.
 *
 * ── THE FOLD ─────────────────────────────────────────────────────────────────
 * A sector with no vertical of its own is still a real sector for the directory
 * and the benchmark cohort; it simply gets the founder layer (runway, ownership,
 * dilution, market size) plus the nearest vertical's KPI set, or the founder
 * layer alone when nothing fits. The fold is data so a listing wizard, the
 * dashboard installer and the marketplace card all agree without a `switch`.
 */

import { STARTUP_SECTORS, type StartupSector } from './startupListing';

export const DASHBOARD_VERTICALS = [
  'ai_ml', 'saas', 'fintech', 'healthtech', 'medtech', 'biotech', 'climate_energy',
  'hardware_robotics', 'cybersecurity', 'marketplace',
] as const;
export type DashboardVertical = (typeof DASHBOARD_VERTICALS)[number];

export const isDashboardVertical = (v: unknown): v is DashboardVertical =>
  typeof v === 'string' && (DASHBOARD_VERTICALS as readonly string[]).includes(v);

/**
 * Where a sector without its own dashboard lands. `null` means the founder layer
 * only. Every sector is named so adding one is a compile error until it is placed.
 */
const SECTOR_FOLD: Record<Exclude<StartupSector, DashboardVertical>, DashboardVertical | null> = {
  ecommerce: 'marketplace',
  consumer_apps: 'marketplace',
  enterprise_software: 'saas',
  edtech: 'saas',
  blockchain: 'fintech',
  gaming: null,
  media_entertainment: null,
  real_estate: null,
  logistics: null,
  other: null,
};

/** The vertical dashboard a sector receives, or `null` for the founder layer alone. */
export function verticalForSector(sector: string | null | undefined): DashboardVertical | null {
  if (!sector) return null;
  if (isDashboardVertical(sector)) return sector;
  if ((STARTUP_SECTORS as readonly string[]).includes(sector)) {
    return SECTOR_FOLD[sector as Exclude<StartupSector, DashboardVertical>];
  }
  return null;
}
