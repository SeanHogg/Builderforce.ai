'use client';

import Link from 'next/link';
import { useTranslations, useFormatter } from 'next-intl';
import { useAttention } from '@/lib/useAttention';

/**
 * Global, ambient "AI Manager" indicator for the TopBar. The manager runs in the
 * background (cron + manual) managing tasks/agents across one project or the whole
 * tenant — so a human on ANY screen should see when it just acted, not only on the
 * Manager tab. It rides the ONE cross-surface attention signal ({@link useAttention},
 * tenant-wide) that every live surface already polls, adding no bespoke plumbing:
 * the server returns `manager: { lastRunAt, recentlyActive }` on that same feed.
 *
 * Self-deciding (returns null when the manager has never run in this workspace, so
 * a tenant that hasn't set one up sees nothing). Pulses while a pass is fresh, else
 * shows "Managed {relative}". Links to the Manager tab. Themed (light + dark) +
 * responsive (the label collapses under a narrow viewport, the dot always shows).
 */
export function ManagerStatusIndicator() {
  const t = useTranslations('managerStatus');
  const format = useFormatter();
  // Tenant-wide (no projectId) — the manager may be scoped to one project OR the
  // whole tenant, and this is a global chip, so MAX(last managed) across the tenant
  // is the right "is the manager working" signal.
  const { manager } = useAttention();

  if (!manager?.lastRunAt) return null; // never managed → nothing to show

  const active = manager.recentlyActive;
  let when = '';
  try {
    when = format.relativeTime(new Date(manager.lastRunAt), new Date());
  } catch {
    when = new Date(manager.lastRunAt).toLocaleString();
  }
  const label = active ? t('active') : t('lastManaged', { when });

  return (
    <Link
      href="/projects?tab=manager"
      title={label}
      aria-label={`${t('ariaLabel')} — ${label}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 999,
        textDecoration: 'none',
        fontSize: '0.78rem',
        fontWeight: 600,
        color: active ? 'var(--accent, #2563eb)' : 'var(--text-muted)',
        border: '1px solid var(--border-subtle)',
        background: active ? 'var(--accent-soft, rgba(37, 99, 235, 0.10))' : 'transparent',
        whiteSpace: 'nowrap',
        maxWidth: '40vw',
        overflow: 'hidden',
      }}
    >
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: 'currentColor',
          animation: active ? 'bf-mgr-pulse 1.2s ease-in-out infinite' : 'none',
        }}
      />
      <span aria-hidden>🧭</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      <style>{'@keyframes bf-mgr-pulse{0%,100%{opacity:.35}50%{opacity:1}}'}</style>
    </Link>
  );
}
