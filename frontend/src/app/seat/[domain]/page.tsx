'use client';

/**
 * ONE route for fifteen domain surfaces (PRD 20 §7.1).
 *
 * "The target is not 134 rewritten pages — it is 15 domain surfaces plus the
 * canvas." `/seat/<domain>` is those fifteen: one dynamic segment validated
 * against the roster, rendering `<DomainSurface>` beside `<RosterNav>`. Adding a
 * sixteenth seat adds a manifest entry in the api and nothing here — the same
 * open/closed answer migration 0410 gave for connector vendors.
 *
 * `/seat` rather than `/<domain>` deliberately: the fifteen names are ordinary
 * words (growth, delivery, people) and a bare top-level segment would shadow
 * existing routes and, worse, would silently claim any future one.
 */

import { use, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { notFound } from 'next/navigation';
import { isDomain, type Domain } from '@/lib/kernel/kernelApi';
import { DomainSurface } from '@/components/kernel/DomainSurface';
import { ObjectPanel } from '@/components/kernel/ObjectPanel';

export default function SeatPage({ params }: { params: Promise<{ domain: string }> }) {
  const { domain } = use(params);
  const locale = useLocale();
  const t = useTranslations('kernel.surface');
  const [openObject, setOpenObject] = useState<string | undefined>();

  if (!isDomain(domain)) notFound();

  return (
    // `RosterNav` used to render a seat rail down the left of this page. It was
    // a THIRD enumeration of the seats — the left panel's RUN rows and the
    // footer roster are the other two — and PRD 21 §11.4.2 allows one: the
    // footer. Switching seats is the rail or a chip now, and this page renders
    // the domain it was asked for.
    <div className="flex min-h-[calc(100vh-4rem)] min-w-0" style={{ background: 'var(--bg-deep)' }}>
      <main className="flex-1 min-w-0 overflow-x-hidden">
        <DomainSurface domain={domain as Domain} onOpenObject={setOpenObject} locale={locale} />
      </main>
      {/* THE detail panel — one mount, owned here, opened by both the roster's
          recents list and the surface's item list. A slide-out, not a modal:
          modals are for destructive approvals only. */}
      {openObject ? (
        <div
          className="fixed inset-y-0 right-0 z-40 w-full sm:w-[min(440px,90vw)] p-3"
          role="dialog"
          aria-modal="false"
          aria-label={t('panelLabel')}
        >
          <ObjectPanel objectId={openObject} onClose={() => setOpenObject(undefined)} locale={locale} />
        </div>
      ) : null}
    </div>
  );
}
