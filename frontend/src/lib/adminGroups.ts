/**
 * Platform Admin information architecture — the SINGLE source of truth for how
 * the 19 admin capabilities are grouped into a smaller set of top-level TABS,
 * each with its own inner sub-views.
 *
 * Pure data (no React) so both the shell nav (`navGroups.ts`, which renders the
 * top <SectionTabs> from `ADMIN_GROUP_META`) and the admin page (which renders
 * the inner sub-tab bar + resolves `?tab=`/`?sub=` to a panel) consume the same
 * config and can never drift.
 *
 * URL scheme: `?tab=<group>&sub=<subview>`. The default group (Overview) uses id
 * '' so a bare `/admin` lands on it; each group's first sub uses id '' so
 * `?tab=<group>` (no `&sub=`) lands on that group's default view.
 */

export interface AdminSubMeta {
  /** `?sub=` value; '' is the group's default sub. */
  id: string;
  /** Stable key → i18n label (`admin.sub.<subKey>`) AND the panel registry. Globally unique. */
  subKey: string;
  icon: string;
}

export interface AdminGroupMeta {
  /** `?tab=` value; '' is the default group (Overview). */
  id: string;
  /** i18n key under the `nav` namespace (shared with <SectionTabs>). */
  labelKey: string;
  icon: string;
  subs: AdminSubMeta[];
}

export const ADMIN_GROUP_META: AdminGroupMeta[] = [
  { id: '', labelKey: 'tab.adminOverview', icon: '🩺', subs: [
    { id: '', subKey: 'health', icon: '🩺' },
  ] },
  { id: 'users', labelKey: 'tab.adminUsers', icon: '👤', subs: [
    { id: '', subKey: 'directory', icon: '👤' },
    { id: 'sessions', subKey: 'sessions', icon: '🧠' },
    { id: 'security', subKey: 'security', icon: '🔒' },
    { id: 'emulation', subKey: 'emulation', icon: '🕵️' },
  ] },
  { id: 'workspaces', labelKey: 'tab.adminWorkspaces', icon: '🏢', subs: [
    { id: '', subKey: 'tenants', icon: '🏢' },
  ] },
  { id: 'access', labelKey: 'tab.adminAccess', icon: '🔐', subs: [
    { id: '', subKey: 'permissions', icon: '🔐' },
    { id: 'modules', subKey: 'modules', icon: '🧩' },
  ] },
  { id: 'llm', labelKey: 'tab.adminLlm', icon: '📊', subs: [
    { id: '', subKey: 'usage', icon: '📊' },
    { id: 'traces', subKey: 'traces', icon: '🔎' },
  ] },
  { id: 'content', labelKey: 'tab.adminContent', icon: '🎭', subs: [
    { id: '', subKey: 'personas', icon: '🎭' },
    { id: 'governance', subKey: 'governance', icon: '⚖️' },
  ] },
  { id: 'compliance', labelKey: 'tab.adminCompliance', icon: '📜', subs: [
    { id: '', subKey: 'legal', icon: '📜' },
    { id: 'privacy', subKey: 'privacy', icon: '🛡' },
  ] },
  { id: 'growth', labelKey: 'tab.adminGrowth', icon: '💳', subs: [
    { id: '', subKey: 'billing', icon: '💳' },
    { id: 'newsletter', subKey: 'newsletter', icon: '✉️' },
    { id: 'releaseNotes', subKey: 'releaseNotes', icon: '📣' },
    { id: 'demoFunnel', subKey: 'demoFunnel', icon: '🎬' },
    { id: 'salesLeads', subKey: 'salesLeads', icon: '📇' },
  ] },
  { id: 'logs', labelKey: 'tab.adminLogs', icon: '📋', subs: [
    { id: '', subKey: 'errors', icon: '🐞' },
    { id: 'audit', subKey: 'audit', icon: '📋' },
    { id: 'feedback', subKey: 'feedback', icon: '💬' },
  ] },
  { id: 'developer', labelKey: 'tab.adminDeveloper', icon: '🔑', subs: [
    { id: '', subKey: 'apiKeys', icon: '🔑' },
    { id: 'token', subKey: 'token', icon: '🎟' },
  ] },
];

/**
 * Legacy single-panel `?tab=` id → new {group, sub}. Keeps every pre-consolidation
 * deep link (e.g. `/admin?tab=security`, bookmarks, the old email links) working.
 */
export const LEGACY_ADMIN_TAB: Record<string, { group: string; sub: string }> = {
  health: { group: '', sub: '' },
  users: { group: 'users', sub: '' },
  security: { group: 'users', sub: 'security' },
  impsessions: { group: 'users', sub: 'emulation' },
  tenants: { group: 'workspaces', sub: '' },
  permissions: { group: 'access', sub: '' },
  modules: { group: 'access', sub: 'modules' },
  usage: { group: 'llm', sub: '' },
  traces: { group: 'llm', sub: 'traces' },
  personas: { group: 'content', sub: '' },
  governance: { group: 'content', sub: 'governance' },
  legal: { group: 'compliance', sub: '' },
  privacy: { group: 'compliance', sub: 'privacy' },
  billing: { group: 'growth', sub: '' },
  newsletter: { group: 'growth', sub: 'newsletter' },
  errors: { group: 'logs', sub: '' },
  auditlog: { group: 'logs', sub: 'audit' },
  apikeys: { group: 'developer', sub: '' },
  token: { group: 'developer', sub: 'token' },
};

/** Resolve `?tab=`/`?sub=` (or a legacy tab id) to a concrete group + sub. */
export function resolveAdminRoute(tabParam: string, subParam: string): { group: AdminGroupMeta; sub: AdminSubMeta } {
  let group = ADMIN_GROUP_META.find((g) => g.id === tabParam);
  let subId = subParam;
  if (!group) {
    const legacy = LEGACY_ADMIN_TAB[tabParam];
    if (legacy) {
      group = ADMIN_GROUP_META.find((g) => g.id === legacy.group);
      subId = legacy.sub;
    }
  }
  if (!group) group = ADMIN_GROUP_META[0];
  const sub = group.subs.find((s) => s.id === subId) ?? group.subs[0];
  return { group, sub };
}

/** Canonical href for a group's sub. Default group '' → /admin; default sub '' → no &sub. */
export function adminSubHref(groupId: string, subId: string): string {
  const base = groupId ? `/admin?tab=${groupId}` : '/admin';
  if (!subId) return base;
  return `${base}${groupId ? '&' : '?'}sub=${subId}`;
}
