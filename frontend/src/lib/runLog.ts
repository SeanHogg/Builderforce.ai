/**
 * runLog — the Builder run/check terminal's narration layer.
 *
 * Every line the Run/Check pipeline writes into the workspace terminal used to be
 * an inline literal with its ANSI escapes spliced in by hand ('\x1b[36m▶ Run
 * started\x1b[0m\r\n'), which made the whole run log the one surface in the
 * product that stayed English while its own dialogs were translated. It also
 * meant the colour vocabulary was re-decided at every call site.
 *
 * This module owns both halves:
 *   • the FORMAT — which glyph and colour a line gets (step, ok, warn, error,
 *     note, banner), so "a successful step is a green ✓" is stated once;
 *   • the TEXT — every line goes through a next-intl translator under the
 *     `ide.runLog.*` keys, so the narration follows the user's locale.
 *
 * What is deliberately NOT translated: the raw output of `npm`, `vite` and `tsc`
 * that is teed straight through {@link RunLog.raw}. That output is the tool's
 * own, it is English wherever the toolchain is, and paraphrasing it would break
 * the copy-paste-into-a-search-box workflow. The narration around it moves; the
 * tool output stays verbatim — which is the only combination that reads
 * coherently in a stream that interleaves the two.
 *
 * Pure and DOM-free (it only calls the `write` it is handed), so the whole log
 * vocabulary is unit-testable without a WebContainer or an xterm instance.
 */

/** Minimal shape of a next-intl translator — kept structural so this module has
 *  no dependency on next-intl itself and stays trivially testable. */
export type RunLogTranslate = (key: string, values?: Record<string, string | number>) => string;

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

/** The horizontal rule that frames a run banner. */
export const RUN_LOG_RULE = '━'.repeat(40);

export interface RunLog {
  /** Tool output (npm/vite/tsc) written through untouched — never translated. */
  raw(text: string): void;
  /** A framed heading: rule, title, rule. */
  banner(key: string, values?: Record<string, string | number>): void;
  /** A short framed heading on one line (`━━━ Running checks ━━━`). */
  bannerInline(key: string, values?: Record<string, string | number>): void;
  /** A cyan pipeline step line (`[1/3] Preparing project files…`). */
  step(key: string, values?: Record<string, string | number>): void;
  /** A cyan sub-heading with a ▶ marker. */
  section(key: string, values?: Record<string, string | number>): void;
  /** An indented green success line. */
  ok(key: string, values?: Record<string, string | number>): void;
  /** An indented amber advisory line. */
  warn(key: string, values?: Record<string, string | number>): void;
  /** A red failure line. */
  error(key: string, values?: Record<string, string | number>): void;
  /** An amber continuation line under an error (no glyph). */
  hint(key: string, values?: Record<string, string | number>): void;
  /** A dimmed parenthetical. */
  note(key: string, values?: Record<string, string | number>): void;
  /** A framed red block: rule, TITLE, body lines, rule. Body entries are
   *  translation keys; pass pre-formatted literals via {@link RunLog.raw}. */
  errorBlock(titleKey: string, bodyKeys: string[]): void;
  /** Blank line. */
  blank(): void;
}

/**
 * Build a {@link RunLog} bound to a terminal writer and a translator.
 *
 * `write` is optional because the terminal is not mounted until the pane is
 * opened — every method is a no-op until it is, which is what lets the pipeline
 * narrate unconditionally instead of guarding each call.
 */
export function createRunLog(write: ((data: string) => void) | undefined, t: RunLogTranslate): RunLog {
  const emit = (line: string) => write?.(line);
  return {
    raw(text) {
      emit(text);
    },
    banner(key, values) {
      emit(`\r\n${CYAN}${RUN_LOG_RULE}${RESET}\r\n`);
      emit(`${CYAN}▶ ${t(key, values)}${RESET}\r\n`);
      emit(`${CYAN}${RUN_LOG_RULE}${RESET}\r\n\r\n`);
    },
    bannerInline(key, values) {
      emit(`\r\n${CYAN}━━━ ${t(key, values)} ━━━${RESET}\r\n`);
    },
    step(key, values) {
      emit(`${CYAN}${t(key, values)}${RESET}\r\n`);
    },
    section(key, values) {
      emit(`\r\n${CYAN}▶ ${t(key, values)}${RESET}\r\n`);
    },
    ok(key, values) {
      emit(`  ${GREEN}✓${RESET} ${t(key, values)}\r\n`);
    },
    warn(key, values) {
      emit(`  ${YELLOW}⚠${RESET} ${t(key, values)}\r\n`);
    },
    error(key, values) {
      emit(`\r\n${RED}✗ ${t(key, values)}${RESET}\r\n`);
    },
    hint(key, values) {
      emit(`${YELLOW}  ${t(key, values)}${RESET}\r\n`);
    },
    note(key, values) {
      emit(`${DIM}  ${t(key, values)}${RESET}\r\n`);
    },
    errorBlock(titleKey, bodyKeys) {
      emit(`\r\n${RED}${RUN_LOG_RULE}${RESET}\r\n`);
      emit(`${RED}✗ ${t(titleKey)}${RESET}\r\n\r\n`);
      for (const key of bodyKeys) emit(`${YELLOW}${t(key)}${RESET}\r\n`);
      emit(`${RED}${RUN_LOG_RULE}${RESET}\r\n`);
    },
    blank() {
      emit('\r\n');
    },
  };
}
