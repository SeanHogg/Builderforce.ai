'use client';

import { useTranslations } from 'next-intl';
import type { BoardTicketOwner } from '@/lib/boardRostersApi';
import { AgentChip } from './AgentChip';

/**
 * Hosts that OWN open tickets in a lane without being staffed on it. Rendered beside the
 * staffed-agent chips but marked ("ticket owner"), because ownership and staffing are
 * different facts and the operator must be able to tell them apart.
 */
export function TicketOwnerChips({ owners }: { owners: readonly BoardTicketOwner[] }) {
  const t = useTranslations('taskMgmt');
  return (
    <>
      {owners.map((o) => (
        <AgentChip
          key={`owner:${o.hostId}`}
          label={o.name}
          meta={t('ticketOwnerMeta')}
          title={t('ticketOwnerTitle', { name: o.name, count: o.ticketCount })}
        />
      ))}
    </>
  );
}
