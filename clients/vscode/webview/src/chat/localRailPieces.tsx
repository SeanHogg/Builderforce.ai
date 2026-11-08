/**
 * What the editor hands `ChatTicketsPanel`'s optional props from the host's local rail copy:
 * the header (sync summary + freshness line) and the per-ticket sync badge. Both draw from the
 * latest `local.chatRail` snapshot; with none yet, nothing is drawn.
 */

import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import {
  RailFreshnessLine, RailSyncSummary, SyncStatusBadge,
  type LocalRailLabels, type TicketLinkVM,
} from '@seanhogg/builderforce-brain-ui';
import type { ChatRef, RailSnapshot } from '../../../src/chatRail/railProtocol';
import type { RailStore } from './localRailAdapter';

const HEADER_STYLE = { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 } as const;

/** The latest local rail snapshot of a chat, re-read when the store changes. */
export function useRailSnapshot(store: RailStore, chatId: ChatRef | null): RailSnapshot | undefined {
  const read = () => (chatId == null ? undefined : store.get(chatId));
  return useSyncExternalStore(store.subscribe, read, read);
}

export function useLocalRailPieces(
  snapshot: RailSnapshot | undefined,
  labels: LocalRailLabels,
  locale: string | undefined,
): { railHeader: ReactNode; ticketBadge: ((tk: TicketLinkVM) => ReactNode) | undefined } {
  return useMemo(() => {
    if (!snapshot) return { railHeader: undefined, ticketBadge: undefined };
    const statusOf = new Map(snapshot.tickets.map((tk) => [`${tk.kind}:${tk.ref}`, tk.syncStatus]));
    return {
      railHeader: (
        <div style={HEADER_STYLE}>
          <RailSyncSummary summary={snapshot.summary} labels={labels} locale={locale} />
          <RailFreshnessLine freshness={snapshot.freshness} labels={labels} locale={locale} />
        </div>
      ),
      ticketBadge: (tk: TicketLinkVM) => {
        const status = statusOf.get(`${tk.kind}:${tk.ref}`);
        return status ? <SyncStatusBadge status={status} labels={labels} /> : null;
      },
    };
  }, [snapshot, labels, locale]);
}
