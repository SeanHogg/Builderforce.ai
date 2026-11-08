/**
 * The committed local-first state as a durable store's `view()` hands it out: the store's own rows,
 * not copies, so every list and row is READONLY in the type. A reader derives from it; the compiler
 * refuses a write. Types only (the webview reaches it through `chatRail/railProtocol.ts`).
 */

import type { LocalFirstSnapshot } from "@builderforce/local-first";

export type LocalFirstView = {
  readonly [K in keyof LocalFirstSnapshot]: LocalFirstSnapshot[K] extends ReadonlyArray<infer Row>
    ? ReadonlyArray<Readonly<Row>>
    : Readonly<LocalFirstSnapshot[K]>;
};
