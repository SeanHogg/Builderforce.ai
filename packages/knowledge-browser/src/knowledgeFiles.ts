/**
 * The browser's `KnowledgeFiles` (agent-tools `fileManifest.ts`): the named text files the replica host keeps beside the local
 * graph (a root's dirty queue, its analysis snapshot, its lock record), in the `files` object store of the SAME database as the
 * rows. `rename` is one transaction, so the host's "write a temp file, then rename" is atomic here too.
 * {@link memoryKnowledgeFiles} is the in-memory twin the best-effort fallback uses when IndexedDB is unavailable.
 */

import type { KnowledgeFiles } from '@builderforce/agent-tools/knowledge';
import { knowledgeDb, promisify, type KnowledgeDb, type KnowledgeDbOptions } from './knowledgeDb';

export function indexedDbKnowledgeFiles(opts: KnowledgeDbOptions & { db?: KnowledgeDb } = {}): KnowledgeFiles {
  const db = opts.db ?? knowledgeDb(opts);
  return {
    read: (name) => db.run(['files'], 'readonly', (store) => promisify(store('files').get(name)) as Promise<string | undefined>),
    write: (name, text) => db.run(['files'], 'readwrite', async (store) => { store('files').put(text, name); }),
    remove: (name) => db.run(['files'], 'readwrite', async (store) => { store('files').delete(name); }),
    rename: (from, to) => db.run(['files'], 'readwrite', async (store) => {
      const text = (await promisify(store('files').get(from))) as string | undefined;
      if (text === undefined) throw new Error(`ENOENT: no such knowledge file: ${from}`);
      store('files').put(text, to);
      store('files').delete(from);
    }),
  };
}

export function memoryKnowledgeFiles(): KnowledgeFiles {
  const held = new Map<string, string>();
  return {
    read: async (name) => held.get(name),
    write: async (name, text) => { held.set(name, text); },
    remove: async (name) => { held.delete(name); },
    rename: async (from, to) => {
      const text = held.get(from);
      if (text === undefined) throw new Error(`ENOENT: no such knowledge file: ${from}`);
      held.set(to, text);
      held.delete(from);
    },
  };
}
