import type { ComponentType } from 'react';
import type { Capability } from '@/lib/rbac';

/**
 * APP-WIDE WIDGET REGISTRY — the single atomic unit behind the unified,
 * pinnable Insights dashboard.
 *
 * Every visualization that can appear on a dashboard — whether it lives inside
 * an insights lens (AI Impact, Delivery, Finance…) OR on any other page
 * (Projects, Quality, Workforce…) — is declared once as a {@link WidgetDef}: a
 * self-contained `Card` (reads its own data, gates itself), an i18n title, the
 * RBAC capability that gates it, and an optional `drill` target (the slide-out
 * report behind the summary). The registry is what makes a card "addable to a
 * dashboard" and "pinnable" from anywhere — no surface owns the dashboard.
 *
 * Mirrors the proven insights panel-registry pattern (aiInsightPanels.tsx) but
 * one level finer: the unit is a CARD, not a whole lens, so a user can pin the
 * exact tile they care about (see the screenshot: a pin in each card corner).
 */

export type WidgetSize = 'sm' | 'md' | 'lg';

/** Where a widget drills to for the full report (a slide-out side panel). */
export type WidgetDrill =
  /** Open the source hub's slide-out lens in place. */
  | { kind: 'panel'; hub: 'ai' | 'delivery' | 'finance' | 'devex'; panel: string }
  /** Navigate to a route (used by non-insights surfaces). */
  | { kind: 'route'; href: string };

/** Props every widget Card receives. `days` is the dashboard's shared window. */
export interface WidgetCardProps {
  days: number;
}

export interface WidgetDef {
  /** Stable global id — also the pin key + the saved-widget `widget_key`. */
  id: string;
  /** i18n key under `widgets.group` for the source-surface label (groups the picker). */
  group: string;
  /** i18n key under `widgets.title` for the card title. */
  titleKey: string;
  /** Optional one-line description i18n key under `widgets.desc`. */
  descKey?: string;
  /** Capability that gates the card content (it self-gates via <RoleGate>). */
  capability?: Capability;
  /** Grid span hint: sm = 1 col, md = wide, lg = full row. Default 'sm'. */
  size?: WidgetSize;
  /** The visualization. Renders ONLY its body — the frame/title/pin are chrome. */
  Card: ComponentType<WidgetCardProps>;
  /** Optional "open the full report" drill-down. */
  drill?: WidgetDrill;
}
