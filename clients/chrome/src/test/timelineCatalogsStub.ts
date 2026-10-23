/**
 * The test stand-in for `virtual:rovr-timeline-catalogs` (served by `build.mjs` from the
 * web's `brain.timeline` catalogs): empty per locale, so every transcript label falls
 * back to brain-ui's defaults. Aliased in `vitest.config.ts`.
 */
const catalogs: Record<'en' | 'de' | 'es' | 'fr' | 'zh', Record<string, unknown>> = { en: {}, de: {}, es: {}, fr: {}, zh: {} };
export default catalogs;
