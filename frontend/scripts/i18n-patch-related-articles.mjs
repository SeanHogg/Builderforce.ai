// <RelatedArticles> carried two hardcoded English strings — its default heading
// and the subtitle under it — on every marketing surface that mounts it. The
// consumers pass a translated `heading`; nothing could translate the subtitle.
// Usage: node scripts/i18n-merge.mjs scripts/i18n-patch-related-articles.mjs
export const PATCHES = {
  en: {
    relatedArticles: {
      heading: 'Related reading',
      subtitle: 'Deeper dives from the Builderforce blog on the topics covered here.',
    },
  },
  zh: {
    relatedArticles: {
      heading: '延伸阅读',
      subtitle: '来自 Builderforce 博客、围绕本页主题的深度文章。',
    },
  },
  es: {
    relatedArticles: {
      heading: 'Lecturas relacionadas',
      subtitle: 'Análisis en profundidad del blog de Builderforce sobre los temas tratados aquí.',
    },
  },
  fr: {
    relatedArticles: {
      heading: 'À lire aussi',
      subtitle: 'Des analyses approfondies du blog Builderforce sur les sujets abordés ici.',
    },
  },
  de: {
    relatedArticles: {
      heading: 'Weiterführende Artikel',
      subtitle: 'Vertiefende Beiträge aus dem Builderforce-Blog zu den hier behandelten Themen.',
    },
  },
};
