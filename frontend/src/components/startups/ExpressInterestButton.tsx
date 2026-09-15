'use client';

/**
 * The profile page's client island: one button that opens the interest panel.
 * The page itself is a server component (indexable, cached at the edge), so the
 * only thing that crosses into the client bundle is this and the panel.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ExpressInterestPanel } from './ExpressInterestPanel';
import { startupPrimaryButtonStyle } from './startupStyles';

export default function ExpressInterestButton({ slug, name }: { slug: string; name: string }) {
  const t = useTranslations('startups.card');
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" style={{ ...startupPrimaryButtonStyle, width: 'auto' }} onClick={() => setOpen(true)}>
        {t('expressInterest')}
      </button>
      <ExpressInterestPanel open={open} onClose={() => setOpen(false)} company={{ slug, name }} />
    </>
  );
}
