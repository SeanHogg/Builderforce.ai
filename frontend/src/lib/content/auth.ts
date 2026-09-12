/**
 * The auth screens' right-hand marketing panel — its STRUCTURE.
 *
 * One panel per audience: `login` (welcome back), and the three account types
 * the register chooser toggles between — `standard` (Build with AI),
 * `freelancer` (Get hired) and `sales`. `RoleChoiceScreen` renders the same
 * panel for an OAuth account that never chose. The panel's words live at
 * `marketing.content.auth.<panel>`; this module owns which stats and bullets it
 * has, in what order, with which glyph, and which FAQ set it closes on.
 */
import { contentKey, type CopyReader } from './copy';
import { faqItems, type FaqItem, type FaqSet } from './faq';

export type AuthPanelId = 'login' | 'standard' | 'freelancer' | 'sales';

interface AuthPanelSpec {
  /** Four headline metrics, rendered as stat cards. */
  stats: readonly string[];
  /** Value-prop bullets — glyph + a localized title and one line. */
  bullets: readonly { id: string; icon: string }[];
  faq: FaqSet;
}

export const AUTH_PANELS: Record<AuthPanelId, AuthPanelSpec> = {
  standard: {
    stats: ['plan', 'trial', 'canvas', 'together'],
    bullets: [
      { id: 'canvas', icon: '✦' },
      { id: 'artifacts', icon: '◫' },
      { id: 'collaborate', icon: '🤝' },
      { id: 'review', icon: '✅' },
      { id: 'journey', icon: '🔀' },
      { id: 'engineering', icon: '🧩' },
    ],
    faq: 'register',
  },
  freelancer: {
    stats: ['commission', 'timeTracking', 'crossTenant', 'resume'],
    bullets: [
      { id: 'profile', icon: '💼' },
      { id: 'resume', icon: '🎬' },
      { id: 'findWork', icon: '🔎' },
      { id: 'timecards', icon: '⏱️' },
      { id: 'beside', icon: '🤝' },
      { id: 'approvePay', icon: '✅' },
    ],
    faq: 'freelancer',
  },
  sales: {
    stats: ['hub', 'weekly', 'campaigns', 'access'],
    bullets: [
      { id: 'markets', icon: '🎯' },
      { id: 'email', icon: '📬' },
      { id: 'leads', icon: '🤝' },
      { id: 'meetings', icon: '📅' },
      { id: 'momentum', icon: '📈' },
      { id: 'toolkit', icon: '🧠' },
    ],
    faq: 'register',
  },
  login: {
    stats: ['plan', 'signIn', 'params', 'commission'],
    bullets: [
      { id: 'evermind', icon: '🧠' },
      { id: 'agents', icon: '🔁' },
      { id: 'kanban', icon: '▦' },
      { id: 'vscode', icon: '🧩' },
      { id: 'passwordless', icon: '🔑' },
      { id: 'tester', icon: '🧪' },
    ],
    faq: 'login',
  },
};

/** A panel with its copy resolved for one locale — what the screens render. */
export interface AuthPanel {
  /** Short eyebrow tag shown above the heading. */
  eyebrow: string;
  heading: string;
  intro: string;
  stats: { id: string; value: string; label: string }[];
  bullets: { id: string; icon: string; title: string; desc: string }[];
  /** Pull-quote reinforcing the differentiator. */
  quote: string;
  faq: FaqItem[];
}

/** Catalog key of a field under one auth panel. */
export function authPanelKey(id: AuthPanelId, path: string): string {
  return contentKey(`auth.${id}.${path}`);
}

export function resolveAuthPanel(t: CopyReader, id: AuthPanelId): AuthPanel {
  const spec = AUTH_PANELS[id];
  return {
    eyebrow: t(authPanelKey(id, 'eyebrow')),
    heading: t(authPanelKey(id, 'heading')),
    intro: t(authPanelKey(id, 'intro')),
    stats: spec.stats.map((stat) => ({
      id: stat,
      value: t(authPanelKey(id, `stats.${stat}.value`)),
      label: t(authPanelKey(id, `stats.${stat}.label`)),
    })),
    bullets: spec.bullets.map((bullet) => ({
      ...bullet,
      title: t(authPanelKey(id, `bullets.${bullet.id}.title`)),
      desc: t(authPanelKey(id, `bullets.${bullet.id}.desc`)),
    })),
    quote: t(authPanelKey(id, 'quote')),
    faq: faqItems(t, spec.faq),
  };
}
