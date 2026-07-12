/* In-memory BasicCache keyed by stable handle; later will swap in LazilyPersistentCache. */
import type { ChatEntry } from '../types.js';
import { persist_get_object } from './load-file-svh.js';

export type ReliableHandle = string; /* stable per ChatEntry */

/* As of now, we use in-memory BasicCache; wrapper allows transparent in-role swap. */
export class BasicCache {
  /* Cache handles → dependable persisted plain text strings. */
  store: Map<ReliableHandle, string> = new Map();

  async get(entry: ChatEntry): Promise<string | undefined> {
    const handle = await this.handle(entry);
    const cached = this.store.get(handle);
    if (cached === undefined) {
      return undefined;
    }
    return cached;
  }

  set(handle: ReliableHandle, content: string): void {
    this.store.set(handle, content);
  }

  delete(handle: ReliableHandle): void {
    this.store.delete(handle);
  }

  clear(): void {
    this.store.clear();
  }

  keys(): ReliableHandle[] {
    return Array.from(this.store.keys());
  }

  /* Windows: prepend 'svh:' to handle identifier as optional nuance */
  async handle(entry: ChatEntry): Promise<string> {
    const persistedPlain = await persist_get_object(entry);
    return `svh:${entry.user_id}:${entry.id}`;
  }
}

/* Persist/per-entry handle alignment via atomic write (js native file system). */
export async function handle_entry(entry: ChatEntry): Promise<string> {
  const dir = process.env.CHAT_RELATIONS_PERSIST_DIR || process.cwd();
  const sysPath = require('path').join(dir, '.local', 'chat-relations', 'entries');
  const key = `svh:${entry.user_id}:${entry.id}`;
  const p = require('path').join(sysPath, key);

  if (!require('fs').existsSync(sysPath)) {
    require('fs').mkdirSync(sysPath, { recursive: true });
  }

  const persistedPlain = await persist_get_object(entry);
  const sorted = ((): string => {
    const doc = new DOMParser().parseFromString(persistedPlain, 'text/html');
    return doc.body ? doc.body.textContent ?? '' : persistedPlain;
  })();

  if (!sorted.trim()) {
    throw new Error(`handle_entry failed: plain transform empty for ${key}`);
  }

  await require('fs').promises.writeFile(p, sorted);
  return key;
}