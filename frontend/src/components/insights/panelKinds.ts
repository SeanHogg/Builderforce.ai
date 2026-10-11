/**
 * Insight panel kinds — the ONE registry of surfaces that can open from the
 * Visitors home. Recording is the only kind in v1; later insight panels
 * (heatmaps, smart events) join this list rather than growing a second enum.
 */
export const INSIGHT_PANEL_KINDS = ['recording'] as const;
export type InsightPanelKind = (typeof INSIGHT_PANEL_KINDS)[number];
