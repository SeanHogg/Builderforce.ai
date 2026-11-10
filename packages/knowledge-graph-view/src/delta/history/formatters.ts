/**
 * How the history and trend write a time and a number. Hosts pass their own locale's formatters (the web's `useFormat`,
 * the webview's use-intl `useFormatter`); these defaults use the runtime's locale, so a host that passes none still reads
 * naturally.
 */

export const defaultFormatTime = (iso: string): string => {
    const at = new Date(iso);
    return Number.isNaN(at.getTime()) ? iso : at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

/** At most two decimals, grouped by the locale. */
export const defaultFormatNumber = (value: number): string => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

export interface DeltaFormatProps {
    formatTime?: ((iso: string) => string) | undefined;
    formatNumber?: ((value: number) => string) | undefined;
}
