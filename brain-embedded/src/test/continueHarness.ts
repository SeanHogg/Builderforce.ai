/**
 * A scripted chat for the continuation tests (`continueChat.test.ts`, `continueClaim.test.ts`): its
 * persistence records every row (and can be made to hold or fail a user row), and its model replays
 * `texts`. Test support only - nothing in the product imports it.
 */

import type { StreamChatResult } from '../streamChatCompletion';
import type { AttachmentPorts, ContinueBinding } from '../runStore/continueChat';
import type { BrainRunRequest } from '../runStore/runTypes';

const answer = (text: string): StreamChatResult => ({ text, toolCalls: [], finishReason: 'stop', resolvedModel: 'fake-model' });
export const ports: AttachmentPorts = { uploadUrl: (key) => `/uploads/${key}` };
export const binding: ContinueBinding = { ports: () => ports };

export type Saved = { chatId: number; role: string; content: string };

/** A chat whose persistence records every row, and whose model replays `texts`. */
export function chat(texts: string[], onAssistantRow?: () => void) {
  const saved: Saved[] = [];
  const asked: Array<Parameters<BrainRunRequest['stream']>[0]['messages']> = [];
  const gate = { failUserRows: false, holdUserRows: null as Promise<void> | null };
  let n = 0;
  let id = 0;
  const byKey = new Map<string, unknown>();
  const stream: BrainRunRequest['stream'] = async (opts) => {
    asked.push(JSON.parse(JSON.stringify(opts.messages)));
    const text = texts[n];
    n += 1;
    if (text === undefined) throw new Error('script exhausted');
    return answer(text);
  };
  const persistence: BrainRunRequest['persistence'] = {
    sendMessages: async (chatId, rows) => {
      if (rows.some((r) => r.role === 'user')) {
        if (gate.holdUserRows) await gate.holdUserRows;
        if (gate.failUserRows) throw new Error('token expired');
      }
      const out: unknown[] = [];
      for (const row of rows) {
        // Upsert on (chat, eventKey): a row sent again under the key it was saved with is the SAME row.
        const prior = row.eventKey ? byKey.get(`${chatId}:${row.eventKey}`) : undefined;
        if (prior) {
          out.push(prior);
          continue;
        }
        saved.push({ chatId, role: row.role, content: row.content });
        if (row.role === 'assistant') onAssistantRow?.();
        const made = { id: (id += 1), chatId, createdAt: '', metadata: row.metadata ?? null, seq: id, ...row };
        if (row.eventKey) byKey.set(`${chatId}:${row.eventKey}`, made);
        out.push(made);
      }
      return out as never;
    },
  };
  return { saved, asked, stream, persistence, gate };
}

/** Runs `fn` the first `count` calls only (a person steers once, not after every answer). */
export const times = (count: number, fn: () => void) => { let left = count; return () => { if (left > 0) { left -= 1; fn(); } }; };

export async function until(check: () => boolean, ms = 3_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
}

export const userRows = (c: { saved: Saved[] }) => c.saved.filter((m) => m.role === 'user').map((m) => m.content);
