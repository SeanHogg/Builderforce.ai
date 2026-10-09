// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { StudioCardList } from './StudioCardList';
import { useStudioApps } from './useStudioApps';

/** The apps started here (any board with an app), each reopened in Studio. Nothing until there is one. */
export function StudioApps() {
  const t = useTranslations('studio.home');
  const cards = useStudioApps();
  return (
    <StudioCardList
      id="studio-apps-title"
      title={t('yourApps')}
      cards={cards}
      action={<Link href="/create?filter=build" style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('allOnCanvas')}</Link>}
    />
  );
}
