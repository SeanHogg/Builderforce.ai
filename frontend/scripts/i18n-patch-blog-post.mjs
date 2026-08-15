// The blog POST page (/blog/<slug>) shipped seven hardcoded English strings —
// the back links, the not-found state, the byline and the closing CTA — while
// the blog INDEX beside it was fully localized. Picked up while wiring
// <BlogFigure> into the post renderer.
// Usage: node scripts/i18n-merge.mjs scripts/i18n-patch-blog-post.mjs
export const PATCHES = {
  en: {
    blog: {
      post: {
        back: '← Back to Blog',
        byline: 'By {author}',
        notFoundTitle: 'Post not found',
        notFoundBody: 'This article doesn’t exist or has been moved.',
        browseAll: 'Browse all articles →',
        relatedHeading: 'Related articles',
        startFree: 'Start building for free →',
      },
    },
  },
  zh: {
    blog: {
      post: {
        back: '← 返回博客',
        byline: '作者：{author}',
        notFoundTitle: '未找到文章',
        notFoundBody: '这篇文章不存在或已被移动。',
        browseAll: '浏览全部文章 →',
        relatedHeading: '相关文章',
        startFree: '免费开始构建 →',
      },
    },
  },
  es: {
    blog: {
      post: {
        back: '← Volver al blog',
        byline: 'Por {author}',
        notFoundTitle: 'Artículo no encontrado',
        notFoundBody: 'Este artículo no existe o se ha movido.',
        browseAll: 'Ver todos los artículos →',
        relatedHeading: 'Artículos relacionados',
        startFree: 'Empieza a crear gratis →',
      },
    },
  },
  fr: {
    blog: {
      post: {
        back: '← Retour au blog',
        byline: 'Par {author}',
        notFoundTitle: 'Article introuvable',
        notFoundBody: 'Cet article n’existe pas ou a été déplacé.',
        browseAll: 'Voir tous les articles →',
        relatedHeading: 'Articles liés',
        startFree: 'Commencez à créer gratuitement →',
      },
    },
  },
  de: {
    blog: {
      post: {
        back: '← Zurück zum Blog',
        byline: 'Von {author}',
        notFoundTitle: 'Beitrag nicht gefunden',
        notFoundBody: 'Dieser Artikel existiert nicht oder wurde verschoben.',
        browseAll: 'Alle Artikel ansehen →',
        relatedHeading: 'Verwandte Artikel',
        startFree: 'Kostenlos loslegen →',
      },
    },
  },
};
