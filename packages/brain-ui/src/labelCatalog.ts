/**
 * The ONE contract every host reads a shared component's copy through.
 *
 * Each host keeps its strings in its own catalog — the web app in next-intl, the VS Code
 * webview in the `vscode.l10n` bundle the extension posts, Rovr in `chrome.i18n` — and
 * each used to hand-build every component's label object, field by field, with its own
 * copy of the key list and (in the editor) a second copy of the English. Now each
 * component has ONE `xxxLabelsFrom(lookup)` builder in this package holding its key list
 * and English defaults, and a host only supplies a {@link LabelLookup}: "this canonical
 * key, in my language — or undefined when my catalog has none".
 *
 * Canonical keys are the label object's own field names; nested records are
 * `field.<key>` (`meters.ai_tokens`), and per-choice copy of a function label is
 * `field.<choice>` (`effortDesc.quick`). A host whose catalog names things differently
 * maps them inside its own lookup — never by renaming catalog keys.
 *
 * Parameterised copy passes its figures as `values` (`{ answer: 3200 }`); the host
 * formats them its own way (ICU on the web, `{name}` substitution in the editor,
 * positional `$1` in Chrome). A string label's placeholders (`{amount}`, `{used}` …)
 * are the components' own tokens and must come back LITERAL.
 *
 * Pure: no React, no i18n library.
 */
import { fill } from './spend/format';

/** Figures a parameterised label is rendered with. */
export type LabelValues = Readonly<Record<string, string | number>>;

/** A host's string for a canonical label key, or undefined when its catalog has none. */
export type LabelLookup = (key: string, values?: LabelValues) => string | undefined;

/**
 * Every string field of `defaults`, read at `prefix + field`. Functions and nested
 * objects are carried over untouched; an empty string counts as "none".
 */
export function stringsFrom<T extends object>(defaults: T, lookup: LabelLookup, prefix = ''): T {
  const out = { ...defaults } as Record<string, unknown>;
  for (const [key, fallback] of Object.entries(defaults)) {
    if (typeof fallback === 'string') out[key] = lookup(`${prefix}${key}`) || fallback;
  }
  return out as T;
}

/**
 * A lookup over a FLAT host bundle (`key → text`, `{name}` placeholders) — the shape the
 * VS Code extension posts. `keyOf` maps a canonical key to the bundle's key (return
 * undefined to leave it to the default); `format` renders a numeric figure for the
 * host's locale before it is substituted.
 */
export function bundleLookup(
  bundle: Readonly<Record<string, string>>,
  keyOf: (key: string) => string | undefined,
  format: (value: number) => string = String,
): LabelLookup {
  return (key, values) => {
    const bundleKey = keyOf(key);
    const text = bundleKey ? bundle[bundleKey] : undefined;
    if (!text) return undefined;
    if (!values) return text;
    const formatted: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) formatted[k] = typeof v === 'number' ? format(v) : v;
    return fill(text, formatted);
  };
}
