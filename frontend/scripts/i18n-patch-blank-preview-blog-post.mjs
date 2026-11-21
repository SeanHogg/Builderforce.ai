// Catalog title/description for the WebContainers 2026.11.9 blog post, `blog.posts.<slug>.*` — the
// convention `src/lib/blogLocale.ts` reads. The English entry mirrors the post's front matter
// exactly (asserted by `blogLocale.test.ts`); the other four match the translated body beside it.
// Usage: node scripts/i18n-merge.mjs scripts/i18n-patch-blank-preview-blog-post.mjs

const SLUG = 'a-blank-preview-now-tells-you-why';

export const PATCHES = {
  en: { blog: { posts: { [SLUG]: {
    title: 'A blank preview now tells you why, and a Laravel API comes up in the tab',
    description: 'BuilderForce WebContainers 2026.11.9 reports what a preview load spent its time on and which origin its security policy blocked, in one call. A custom package CDN joins the preview policy by itself. And a Vite frontend, a Laravel API and Postgres now start together in the browser tab, with php artisan serve included.',
  } } } },
  zh: { blog: { posts: { [SLUG]: {
    title: '空白的预览现在会告诉你原因，Laravel API 也能在标签页里启动了',
    description: 'BuilderForce WebContainers 2026.11.9 只需一次调用，就能报告预览加载把时间花在了哪里，以及安全策略拦截了哪个来源。自定义包 CDN 会自动加入预览策略。Vite 前端、Laravel API 和 Postgres 现在也能在浏览器标签页里一起启动，php artisan serve 同样可用。',
  } } } },
  es: { blog: { posts: { [SLUG]: {
    title: 'Una vista previa en blanco ahora te dice por qué, y una API de Laravel arranca en la pestaña',
    description: 'BuilderForce WebContainers 2026.11.9 informa, con una sola llamada, en qué gastó el tiempo la carga de una vista previa y qué origen bloqueó su política de seguridad. Un CDN de paquetes personalizado entra solo en la política de la vista previa. Y un frontend de Vite, una API de Laravel y Postgres ahora arrancan juntos en la pestaña del navegador, php artisan serve incluido.',
  } } } },
  fr: { blog: { posts: { [SLUG]: {
    title: 'Un aperçu vide vous dit maintenant pourquoi, et une API Laravel démarre dans l\'onglet',
    description: 'BuilderForce WebContainers 2026.11.9 indique, en un seul appel, où le chargement d\'un aperçu a passé son temps et quelle origine sa politique de sécurité a bloquée. Un CDN de paquets personnalisé rejoint de lui-même la politique de l\'aperçu. Et un frontend Vite, une API Laravel et Postgres démarrent désormais ensemble dans l\'onglet du navigateur, php artisan serve compris.',
  } } } },
  de: { blog: { posts: { [SLUG]: {
    title: 'Eine leere Vorschau sagt Ihnen jetzt, warum, und eine Laravel-API startet im Tab',
    description: 'BuilderForce WebContainers 2026.11.9 meldet mit einem Aufruf, wofür das Laden einer Vorschau seine Zeit gebraucht hat und welchen Origin ihre Sicherheitsrichtlinie blockiert hat. Ein eigenes Paket-CDN kommt von selbst in die Richtlinie der Vorschau. Und ein Vite-Frontend, eine Laravel-API und Postgres starten jetzt gemeinsam im Browser-Tab, php artisan serve eingeschlossen.',
  } } } },
};
