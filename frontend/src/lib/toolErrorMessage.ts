/**
 * The error text a canvas TOOL RESULT hands the model — English by contract.
 *
 * A tool's `{ error }` is read by the LLM that called it, beside an English
 * `instruction`, never by a person; translating it would only make the model
 * relay a sentence in a language the conversation may not be in. That is the
 * opposite rule to a surface a person reads, which goes through
 * `useErrorMessage()` (`@/i18n/useErrorMessage`) and `common.actionFailed`.
 *
 * Both used to be spelled `error instanceof Error ? error.message : '…'`, so a
 * reader could not tell a model-facing fallback from an untranslated UI string,
 * and `check:error-fallbacks` could not either. Naming the model-facing half is
 * what lets the guard hold the UI half at zero: a literal fallback may appear
 * ONLY as this function's argument.
 *
 * An `Error` with an empty message falls back too — the old ternary handed the
 * model `''`, which reads as "no error".
 */
export function toolErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
