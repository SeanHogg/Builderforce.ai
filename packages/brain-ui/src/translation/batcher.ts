/**
 * Coalesces the cloud translation calls made within one short window into as few requests as the
 * route allows (≤ 20 texts each, one request per `to`/`from` pair). Identical texts in a
 * tick share one slot. A failed request rejects every caller in it, so each message falls
 * back to showing its original on its own.
 */
import type { CloudTranslate } from './context';

export const TRANSLATE_BATCH_MAX = 20;

/** How long a tick's callers wait for company before the request goes — a scrolled page's rows arrive over tens of ms. */
export const TRANSLATE_BATCH_WINDOW_MS = 40;

export type TranslateSend = (texts: string[], to: string, from?: string) => Promise<string[]>;

interface Waiter { text: string; resolve(value: string): void; reject(reason: unknown): void }

export function createTranslateBatcher(send: TranslateSend, max: number = TRANSLATE_BATCH_MAX): CloudTranslate {
  const queues = new Map<string, { to: string; from?: string; waiters: Waiter[] }>();
  let scheduled = false;

  const flush = (): void => {
    scheduled = false;
    const groups = [...queues.values()];
    queues.clear();
    for (const group of groups) {
      const unique = [...new Set(group.waiters.map((w) => w.text))];
      for (let i = 0; i < unique.length; i += max) {
        const chunk = unique.slice(i, i + max);
        const waiting = group.waiters.filter((w) => chunk.includes(w.text));
        send(chunk, group.to, group.from).then(
          (out) => {
            for (const w of waiting) {
              const translated = out[chunk.indexOf(w.text)];
              if (typeof translated === 'string') w.resolve(translated);
              else w.reject(new Error('translate: short response'));
            }
          },
          (err) => { for (const w of waiting) w.reject(err); },
        );
      }
    }
  };

  return (texts, to, from) => {
    const key = `${to}|${from ?? ''}`;
    let group = queues.get(key);
    if (!group) {
      group = { to, ...(from ? { from } : {}), waiters: [] };
      queues.set(key, group);
    }
    const target = group;
    const pending = texts.map((text) => new Promise<string>((resolve, reject) => { target.waiters.push({ text, resolve, reject }); }));
    if (!scheduled) {
      scheduled = true;
      setTimeout(flush, TRANSLATE_BATCH_WINDOW_MS);
    }
    return Promise.all(pending);
  };
}
