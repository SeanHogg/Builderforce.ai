/**
 * Context INGRESS — what the person put in front of the model (an attached text file,
 * "Add context", a `#file` reference) turned into the turn's inlined block. ONE assembly
 * for the panel's attachments and the native chat participant's references:
 *
 *   1. prose (`.md .txt .log .rst .adoc …` — `proseKindOf`) over the minimum is
 *      compressed (cost lever C8, LLMLingua-2 through Builderforce Desktop); code never is
 *      — an edit needs its exact bytes;
 *   2. every text is fitted to the turn's mention budget (`mentionBudget`, per file and
 *      in total) with a marker naming what was cut;
 *   3. each is fenced under its name.
 *
 * Pure (no `vscode`): the compressor, the lever decision and the log are injected, so the
 * assembly is tested without an extension host. `hostIngress.ts` wires the real ones.
 */

import { proseKindOf, type CompressLargeContextResult, type ProseKind } from "@builderforce/agent-tools";
import { inlineMentions, type Mention, type MentionBudget } from "@builderforce/tool-output-policy";

/** Prose shorter than this is cheap enough to send as it is. */
export const INGRESS_COMPRESS_MIN_CHARS = 2_000;

/** One text to inline: its name in the turn (a relative path or file name) and its text. */
export interface IngressText {
  name: string;
  text: string;
}

/** The file a text is named after: a range reference (`notes.md:1-40`) without its range,
 *  so prose vs code is decided by the extension and not by the line numbers. */
export function ingressPathOf(name: string): string {
  return name.replace(/:\d+(?:-\d+)?$/, "");
}

export interface IngressDeps {
  /** The C8 compressor (`desktopCompressProse`), or absent when the lever is off. */
  compress?: (text: string, kind: ProseKind, opts: { minChars: number }) => Promise<CompressLargeContextResult>;
  /** Where a compression's savings are recorded (the output channel). */
  log?: (line: string) => void;
}

/** One text after the C8 step: compressed when it is prose, long enough, and the lever is on. */
async function compressed(entry: IngressText, deps: IngressDeps): Promise<Mention> {
  const kind = proseKindOf(ingressPathOf(entry.name));
  if (!deps.compress || kind === "code" || entry.text.length < INGRESS_COMPRESS_MIN_CHARS) return { name: entry.name, text: entry.text };
  try {
    const r = await deps.compress(entry.text, kind, { minChars: INGRESS_COMPRESS_MIN_CHARS });
    if (!r.compressed) return { name: entry.name, text: entry.text };
    deps.log?.(`[ingress] ${entry.name}: attachment compressed (C8) ${r.originalTokens} → ${r.keptTokens} tokens`);
    return { name: entry.name, text: r.text, note: "compressed for reading — read the file for its exact text" };
  } catch {
    // A compressor failure costs the saving, never the attachment.
    return { name: entry.name, text: entry.text };
  }
}

/** The turn's inlined block for `entries` under `budget`; '' for none. */
export async function ingressBlock(entries: readonly IngressText[], budget: MentionBudget, deps: IngressDeps = {}): Promise<string> {
  if (entries.length === 0) return "";
  const mentions = await Promise.all(entries.map((e) => compressed(e, deps)));
  return inlineMentions(mentions, budget);
}
