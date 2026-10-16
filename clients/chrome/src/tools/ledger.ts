/**
 * The ACTION LEDGER — every browser action Rovr took or was refused, in order, per chat:
 * which tool, on which tab and URL, against what, and how it ended.
 *
 * It is recorded in three places on purpose, each for its own reader:
 *   - the device record (`RovrRecords.addLedger`) — the side panel's Actions view, which
 *     works offline and survives the panel closing;
 *   - the tool RESULT itself (`action` on the result object) — so the step row the Brain
 *     loop persists for the call carries the same facts through the durable step outbox
 *     to the platform chat, where the web app and the VS Code panel render it;
 *   - live subscribers — the panel updates as the run acts.
 */
import type { LedgerEntry, LedgerOutcome, RovrRecords } from '../store/records';

export interface LedgerFacts {
  tool: string;
  target: string;
  tabId: number | null;
  url: string;
  outcome: LedgerOutcome;
  detail: string;
  image?: string;
}

/** The slice of a ledger entry that rides on the tool result (and so the step row). */
export interface LedgerStamp {
  tool: string;
  target: string;
  tabId: number | null;
  url: string;
  outcome: LedgerOutcome;
  at: string;
}

export interface ActionLedger {
  record(chatId: number, facts: LedgerFacts): Promise<LedgerStamp>;
  list(chatId: number): Promise<LedgerEntry[]>;
  subscribe(listener: (chatId: number) => void): () => void;
}

/** Detail kept on an entry — enough to read, never a page dump. */
export const LEDGER_DETAIL_MAX = 500;

export function createActionLedger(
  records: Pick<RovrRecords, 'addLedger' | 'listLedger'>,
  opts: { now?: () => Date; newId?: () => string } = {},
): ActionLedger {
  const now = opts.now ?? (() => new Date());
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const listeners = new Set<(chatId: number) => void>();
  return {
    async record(chatId, facts) {
      const at = now().toISOString();
      const entry: LedgerEntry = {
        id: newId(),
        chatId,
        at,
        tool: facts.tool,
        target: facts.target.slice(0, 200),
        tabId: facts.tabId,
        url: facts.url,
        outcome: facts.outcome,
        detail: facts.detail.slice(0, LEDGER_DETAIL_MAX),
        ...(facts.image ? { image: facts.image } : {}),
      };
      try {
        await records.addLedger(entry);
      } finally {
        for (const l of [...listeners]) l(chatId);
      }
      return { tool: entry.tool, target: entry.target, tabId: entry.tabId, url: entry.url, outcome: entry.outcome, at };
    },
    list: (chatId) => records.listLedger(chatId),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
