/**
 * What counts as an IMPLEMENTED control — stated once.
 *
 * `soc_controls.status` is free text with a default of `not_started`, and three
 * different importers have written three different spellings of "this control is
 * in place" (`implemented`, `passed`, `operating`, …). The list of spellings was
 * a private constant inside `AuditRunner.ts` while the governance rollup needed
 * the same gate to count `governance.controls_passing`.
 *
 * Two copies of that list is the failure mode the platform's DRY rule exists for,
 * and it is worse here than usual: a status the audit report treats as passing and
 * the chart treats as failing produces a compliance surface that contradicts the
 * compliance report, with no way for a reader to tell which one is lying.
 */

/** Every spelling of "in place" any importer has ever written. Lower-cased. */
export const IMPLEMENTED_CONTROL_STATUSES = [
  'implemented', 'complete', 'completed', 'operating', 'done', 'passed', 'pass',
] as const;

/** Is this control in place? The ONE gate; never re-derive it from the list. */
export function isControlImplemented(status: string | null | undefined): boolean {
  return (IMPLEMENTED_CONTROL_STATUSES as readonly string[]).includes((status ?? '').toLowerCase());
}
