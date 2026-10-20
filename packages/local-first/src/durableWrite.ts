/**
 * Durable acknowledgement for an atomic write.
 *
 * `{ written: true }` is returned only after `writeAtomic` resolves. A
 * rejection — or a synchronous throw — becomes `{ written: false, code:
 * 'write_failed' }` and is not rethrown.
 *
 * This module does not open a file, rename a temp path, or write any buffer
 * itself. A partial write is the injected writer's problem; this layer never
 * produces one.
 *
 * `writeAtomic` defaults to the export from `atomicWrite.ts`
 * (`commitWriteAndEnqueue`). That export is the domain-record commit boundary,
 * not a path/bytes writer. Calling it with a path fails closed inside this
 * wrapper instead of persisting `bytes`. Hosts that persist bytes inject their
 * atomic writer.
 */

import { commitWriteAndEnqueue } from './atomicWrite.js';

/** Injected atomic writer. Tests pass a fake; hosts pass their rename. */
export type WriteAtomic = (target: string, bytes: Uint8Array) => Promise<unknown>;

export type DurableWriteResult =
  | { readonly written: true }
  | { readonly written: false; readonly code: 'write_failed' };

/**
 * The real `atomicWrite.ts` export. It does not accept `(target, bytes)`;
 * the default still points at it so this module has no second write path.
 */
const atomicWriteExport = commitWriteAndEnqueue as unknown as WriteAtomic;

/**
 * Acknowledge a durable write only after `writeAtomic` resolves.
 * Does not write `bytes` itself.
 */
export async function writeDurably(
  target: string,
  bytes: Uint8Array,
  writeAtomic: WriteAtomic = atomicWriteExport,
): Promise<DurableWriteResult> {
  try {
    await writeAtomic(target, bytes);
    return { written: true };
  } catch {
    return { written: false, code: 'write_failed' };
  }
}
