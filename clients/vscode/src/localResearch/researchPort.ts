/**
 * The editor's handle on a LOCAL model for `local_research` — registered once at
 * activation (`editorResearchPort.ts`, which reads the local-model settings and so needs
 * `vscode`), read by the tool layer, which must stay `vscode`-free (the headless harness
 * runs it). Unregistered ⇒ no local research: the tool is not advertised.
 */

import type { LocalResearchMessage } from "@builderforce/agent-tools";

export interface LocalResearchPort {
  /** A completion on a model on THIS machine only — never the gateway. */
  complete(messages: readonly LocalResearchMessage[], signal: AbortSignal): Promise<string>;
  /** Whether any local runtime can serve right now (memoized probe). */
  available(): Promise<boolean>;
}

let port: LocalResearchPort | null = null;

export function setLocalResearchPort(next: LocalResearchPort | null): void {
  port = next;
}

export function localResearchPort(): LocalResearchPort | null {
  return port;
}

/** The catalog filter: `local_research` stays only while a local model can answer it. */
export async function withLocalResearch<T extends { name: string }>(defs: readonly T[]): Promise<T[]> {
  const live = port ? await port.available().catch(() => false) : false;
  return live ? [...defs] : defs.filter((d) => d.name !== "local_research");
}
