// Catalog title/description for the browser-runs blog post, `blog.posts.<slug>.*` — the
// convention `src/lib/blogLocale.ts` reads. The English entry mirrors the post's front matter
// exactly (asserted by `blogLocale.test.ts`); the other four match the translated body beside it.
// Usage: node scripts/i18n-merge.mjs scripts/i18n-patch-browser-runs-blog-post.mjs

const SLUG = 'your-full-stack-app-now-runs-in-your-browser-tab';

export const PATCHES = {
  en: { blog: { posts: { [SLUG]: {
    title: 'Your full-stack app now runs in the browser tab you built it in',
    description: 'A frontend, an API and a Postgres database used to need a cloud container before you could see them work together. Now Run starts all three inside your browser tab — Node, Python and PHP services (FastAPI, Flask, Django, Laravel, Slim) with Postgres, with no container to boot or provision and no cloud compute — and the Brain reads its logs, restarts it and captures its preview the same way it does for a container.',
  } } } },
  zh: { blog: { posts: { [SLUG]: {
    title: '你的全栈应用现在就在你构建它的浏览器标签页里运行',
    description: '前端、API 和 Postgres 数据库过去需要云容器才能看到它们协同工作。现在 Run 会在浏览器标签页内同时启动这三者——Node、Python 和 PHP 服务（FastAPI、Flask、Django、Laravel、Slim）连同 Postgres，无需启动或配置容器，也不消耗云端算力——Brain 读取日志、重启服务、捕获预览的方式与对待容器时相同。',
  } } } },
  es: { blog: { posts: { [SLUG]: {
    title: 'Tu app full-stack ahora se ejecuta en la pestaña del navegador donde la creaste',
    description: 'Un frontend, una API y una base de datos Postgres necesitaban un contenedor en la nube antes de verlos funcionar juntos. Ahora Run inicia los tres dentro de tu pestaña del navegador —servicios Node, Python y PHP (FastAPI, Flask, Django, Laravel, Slim) con Postgres, sin contenedor que arrancar ni aprovisionar y sin cómputo en la nube— y el Brain lee sus logs, la reinicia y captura su vista previa igual que con un contenedor.',
  } } } },
  fr: { blog: { posts: { [SLUG]: {
    title: 'Votre app full-stack s\'exécute maintenant dans l\'onglet de navigateur où vous l\'avez créée',
    description: 'Un frontend, une API et une base Postgres nécessitaient un conteneur cloud avant de les voir fonctionner ensemble. Désormais Run démarre les trois dans votre onglet de navigateur — des services Node, Python et PHP (FastAPI, Flask, Django, Laravel, Slim) avec Postgres, sans conteneur à démarrer ni à provisionner et sans calcul cloud — et le Brain lit ses logs, la redémarre et capture son aperçu comme pour un conteneur.',
  } } } },
  de: { blog: { posts: { [SLUG]: {
    title: 'Ihre Full-Stack-App läuft jetzt in dem Browser-Tab, in dem Sie sie gebaut haben',
    description: 'Ein Frontend, eine API und eine Postgres-Datenbank brauchten früher einen Cloud-Container, bevor man sie zusammenarbeiten sah. Jetzt startet Run alle drei in Ihrem Browser-Tab — Node-, Python- und PHP-Dienste (FastAPI, Flask, Django, Laravel, Slim) mit Postgres, ohne Container, der gestartet oder bereitgestellt werden muss, und ohne Cloud-Rechenleistung — und das Brain liest ihre Logs, startet sie neu und erfasst ihre Vorschau wie bei einem Container.',
  } } } },
};
