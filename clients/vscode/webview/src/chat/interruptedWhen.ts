/** When an interrupted run was interrupted: `iso` in the editor's locale (`init.locale`); the raw text when it is not a date. */
export function interruptedWhen(iso: string, locale: string | undefined): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString(locale);
}
