// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { BrandLockup } from '@/components/BrandLockup';
import { STUDIO_ROUTE } from '@/lib/studio/studioHost';
import { StudioAccountControl } from './StudioAccountControl';

/**
 * Studio's bar for pages that are not a project: the mark (home), whatever the
 * page puts on the right (`children`), and the account control.
 *
 * An OPEN project does not render this bar at all: it hands {@link StudioBrand}
 * and its actions to the workspace header, so there is one row of actions, not
 * a Studio row stacked on a workspace row.
 */
export function StudioTopBar({ children }: { children?: ReactNode }) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        padding: '10px clamp(12px, 3vw, 24px)',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-deep)',
      }}
    >
      <StudioBrand />
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {children}
        <StudioAccountControl />
      </div>
    </header>
  );
}

/**
 * The Studio mark, linking home. `compact` drops the wordmark — inside the
 * workspace header the project's name is the title, and the mark alone says
 * where you are.
 */
export function StudioBrand({ compact = false }: { compact?: boolean }) {
  const t = useTranslations('studio.topBar');
  // Both halves of the wordmark are `--text-primary`, so it reads on a dark
  // bar and a light one; `Studio` is never the accent colour.
  return (
    <BrandLockup href={STUDIO_ROUTE} label={t('home')} size={compact ? 24 : 26}>
      {!compact && (
        <span style={{ color: 'var(--text-primary)', fontWeight: 800, fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}>
          Builderforce Studio
        </span>
      )}
    </BrandLockup>
  );
}
