/**
 * Built-in vertical KPI dashboard templates (PRD 25 A5).
 *
 * One template per DASHBOARD_VERTICALS sector plus a founder fallback. Category
 * `analytics`. No connectors. One `choose('size_band')` so the installer can
 * bind `{{setup.size_band}}` onto the dashboard output (guidedPlan walks the
 * whole token, so the step id must be `size_band`).
 *
 * Keys are data driven off DASHBOARD_VERTICALS — adding a vertical is a data
 * change, not a new switch.
 */

import { DASHBOARD_VERTICALS, type DashboardVertical } from '@builderforce/creation-canvas-contract';
import type { BuiltinTemplate } from './dsl';
import { choose } from './dsl';

const VERTICAL_NAME: Record<DashboardVertical, string> = {
  ai_ml: 'AI-native',
  saas: 'SaaS',
  fintech: 'FinTech',
  healthtech: 'Digital health',
  medtech: 'MedTech',
  biotech: 'BioTech',
  climate_energy: 'Climate & energy',
  hardware_robotics: 'Hardware & robotics',
  cybersecurity: 'Cybersecurity',
  marketplace: 'Marketplace',
};

const VERTICAL_ICON: Record<DashboardVertical, string> = {
  ai_ml: '🤖',
  saas: '🧩',
  fintech: '💳',
  healthtech: '🩺',
  medtech: '🩹',
  biotech: '🧬',
  climate_energy: '🌍',
  hardware_robotics: '🦾',
  cybersecurity: '🛡️',
  marketplace: '🛒',
};

const SIZE_BANDS = [
  { value: 'small', label: 'Small (1–50)' },
  { value: 'mid', label: 'Mid (51–500)' },
  { value: 'large', label: 'Large (500+)' },
] as const;

function sizeBandStep() {
  return choose(
    'size_band',
    'How big is the company?',
    'Sets the peer cohort the dashboard compares you against. Mid is the default if you skip this.',
    SIZE_BANDS,
    'mid',
  );
}

function dashboardTemplate(args: {
  key: string;
  name: string;
  summary: string;
  icon: string;
  preset: string;
  sector?: DashboardVertical;
}): BuiltinTemplate {
  return {
    key: args.key,
    name: args.name,
    summary: args.summary,
    category: 'analytics',
    icon: args.icon,
    requiredConnectors: [],
    steps: [sizeBandStep()],
    outputs: [{
      kind: 'dashboard',
      id: 'dashboard',
      preset: args.preset,
      ...(args.sector ? { sector: args.sector } : {}),
      sizeBand: '{{setup.size_band}}',
    }],
  };
}

const FOUNDER: BuiltinTemplate = dashboardTemplate({
  key: 'vertical-dashboard-founder',
  name: 'Founder KPI dashboard',
  summary: 'Runway, cash, ownership and peer position — the tiles every founder watches, regardless of sector.',
  icon: '🚀',
  preset: 'founder',
});

/**
 * A template key may only carry `[a-z0-9-]`, but a sector id is snake_case
 * (`climate_energy`). Hyphenate for the key and keep the sector verbatim in the
 * output, so the catalogue validates while the dashboard still resolves the
 * cohort by its real sector id.
 */
export const dashboardTemplateKeyFor = (sector: DashboardVertical | null): string =>
  sector ? `vertical-dashboard-${sector.replace(/_/g, '-')}` : 'vertical-dashboard-founder';

const VERTICALS: BuiltinTemplate[] = DASHBOARD_VERTICALS.map((sector) => dashboardTemplate({
  key: dashboardTemplateKeyFor(sector),
  name: `${VERTICAL_NAME[sector]} KPI dashboard`,
  summary: `The founder KPI set plus this vertical's peer-cohort tile. Installs onto /finance?tab=dashboard.`,
  icon: VERTICAL_ICON[sector],
  preset: sector,
  sector,
}));

export const VERTICAL_DASHBOARD_TEMPLATES: readonly BuiltinTemplate[] = [FOUNDER, ...VERTICALS];
