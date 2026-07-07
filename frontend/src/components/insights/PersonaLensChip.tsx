'use client';

/**
 * PersonaLensChip — a compact chip for the Insights nav/hub that surfaces the
 * signed-in user's primary lens persona and links to that persona's HOME lens
 * plus its next highlighted lenses. Pure view-shaping: it is an affordance, not a
 * gate (the lens pages remain role-gated). Links to /settings/persona to change it.
 */

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useLensPersona } from '@/lib/useLensPersona';
import { LENS_ROUTES } from '@/lib/lensPersona';

export function PersonaLensChip() {
  const t = useTranslations('personaLens');
  const { persona, lenses, loading } = useLensPersona();
  if (loading) return null;

  return (
    <div
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: '6px 10px', borderRadius: 10,
        background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
      }}
    >
      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{t('viewingAs')}</span>
      <Link
        href="/settings/persona"
        style={{
          fontSize: 12, fontWeight: 700, textDecoration: 'none', padding: '2px 8px', borderRadius: 999,
          color: '#fff', background: 'var(--accent, #6366f1)',
        }}
      >
        {t(`personas.${persona}`)}
      </Link>
      <span style={{ width: 1, height: 16, background: 'var(--border-subtle)' }} />
      {lenses.slice(0, 3).map((lens) => (
        <Link
          key={lens}
          href={LENS_ROUTES[lens].href}
          style={{
            fontSize: 12, fontWeight: 600, textDecoration: 'none', color: 'var(--text-secondary)',
          }}
        >
          {t(`lenses.${lens}`)}
        </Link>
      ))}
    </div>
  );
}
