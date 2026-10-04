/**
 * The line shown beside a project's name — or null when it would only repeat it.
 *
 * A project started from a prompt is named after the prompt's first words
 * (`projectNameFromPrompt`) and keeps the whole prompt as its description. Both
 * are worth storing; showing both side by side is not. The workspace bar used to
 * render "Build me a marketing websi" in the name field and "— Build me a
 * marketing website f…" right next to it: one sentence, twice, truncated two
 * different ways.
 *
 * So the description earns its place only when it says something the name does
 * not. Comparison ignores case, whitespace runs and a trailing ellipsis, because
 * that is exactly how a derived name differs from its source.
 */
export function projectSubtitle(name: string, description: string | null | undefined): string | null {
  const text = description?.trim();
  if (!text) return null;
  const subject = normalize(name);
  const body = normalize(text);
  if (!subject || body.startsWith(subject)) return null;
  return text;
}

function normalize(value: string): string {
  return value.trim().replace(/(…|\.\.\.)$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}
