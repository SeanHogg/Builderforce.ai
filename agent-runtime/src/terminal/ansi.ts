const ANSI_SGR_PATTERN = "\\x1b\\[[0-9;]*m";
// OSC-8 hyperlinks: ESC ] 8 ; ; url ST ... ESC ] 8 ; ; ST
const OSC8_PATTERN = "\\x1b\\]8;;.*?\\x1b\\\\|\\x1b\\]8;;\\x1b\\\\";

const ANSI_REGEX = new RegExp(ANSI_SGR_PATTERN, "g");
const OSC8_REGEX = new RegExp(OSC8_PATTERN, "g");

export function stripAnsi(input: string): string {
  return input.replace(OSC8_REGEX, "").replace(ANSI_REGEX, "");
}

export function visibleWidth(input: string): number {
  return Array.from(stripAnsi(input)).length;
}

const ESCAPE_REGEX = new RegExp(`${OSC8_PATTERN}|${ANSI_SGR_PATTERN}`, "g");

/**
 * Truncate `input` to a visible width of `width` columns (ANSI-aware), appending
 * `ellipsis` only when content is actually clipped. ANSI SGR / OSC-8 escapes pass
 * through without counting toward width — so styling (and trailing resets) survive
 * the cut. Visible length is counted in code points, consistent with {@link visibleWidth}.
 *
 * Native, dependency-free replacement for `@mariozechner/pi-tui`'s `truncateToWidth`
 * (PRD 11 §5.1 Stage 4 — removes a `@mariozechner/pi-tui` import site).
 */
export function truncateToWidth(input: string, width: number, ellipsis = "…"): string {
  if (width <= 0) return "";
  if (visibleWidth(input) <= width) return input;
  const budget = Math.max(0, width - visibleWidth(ellipsis));
  let out = "";
  let used = 0;
  let clipped = false;
  let lastIndex = 0;
  const appendVisible = (chunk: string): void => {
    for (const ch of chunk) {
      if (used >= budget) {
        clipped = true;
        return;
      }
      out += ch;
      used += 1;
    }
  };
  let match: RegExpExecArray | null;
  ESCAPE_REGEX.lastIndex = 0;
  while ((match = ESCAPE_REGEX.exec(input)) !== null) {
    if (!clipped) appendVisible(input.slice(lastIndex, match.index));
    out += match[0]; // keep every escape (incl. trailing reset) regardless of the cut
    lastIndex = match.index + match[0].length;
  }
  if (!clipped) appendVisible(input.slice(lastIndex));
  return out + ellipsis;
}
