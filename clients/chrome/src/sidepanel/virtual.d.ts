/** Supplied by `build.mjs`: the web app's `brain.timeline` catalog for each locale. */
declare module 'virtual:rovr-timeline-catalogs' {
  const catalogs: Record<'en' | 'de' | 'es' | 'fr' | 'zh', Record<string, unknown>>;
  export default catalogs;
}

/** Supplied by `build.mjs`: the web app's `knowledgeGraph` catalog for each locale. */
declare module 'virtual:rovr-knowledge-catalogs' {
  const catalogs: Record<'en' | 'de' | 'es' | 'fr' | 'zh', Record<string, unknown>>;
  export default catalogs;
}

/** Side-effect stylesheet imports — esbuild bundles them into the panel's CSS. */
declare module '*.css';
