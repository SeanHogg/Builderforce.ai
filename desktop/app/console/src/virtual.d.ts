declare module 'virtual:evermind-labels' {
  /** `{ locale: { 'ev.key': text } }`, derived at build time (see `labels.ts`). */
  const bundles: Record<string, Record<string, string>>;
  export default bundles;
}
