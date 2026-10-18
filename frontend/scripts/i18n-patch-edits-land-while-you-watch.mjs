// Catalog title/description for the "edits land while you watch" blog post, `blog.posts.<slug>.*`,
// the convention `src/lib/blogLocale.ts` reads. The English entry mirrors the post's
// front matter exactly (asserted by `blogLocale.test.ts`); the other four match the
// translated bodies published beside it.
// Usage: node scripts/i18n-merge.mjs scripts/i18n-patch-edits-land-while-you-watch.mjs

const SLUG = 'edits-land-while-you-watch';

export const PATCHES = {
  en: { blog: { posts: {
    [SLUG]: {
      title: 'Edits land while you watch — hot updates, real stylesheets and the frameworks you already use',
      description: 'The app you build on a Builderforce canvas now updates in place as you edit, keeping what you typed and where you scrolled. It compiles Sass, SCSS and Less, scopes CSS Modules for real, loads the stylesheets your packages ship, and runs Next.js and SvelteKit dev servers in the browser.',
    },
  } } },
  zh: { blog: { posts: {
    [SLUG]: {
      title: '修改即刻生效——热更新、真正的样式表，以及你已经在用的框架',
      description: '你在 Builderforce 画布上构建的应用，现在会在你编辑时原地更新，保留你输入的内容和滚动的位置。它能编译 Sass、SCSS 和 Less，真正隔离 CSS Modules，加载你所用包自带的样式表，还能在浏览器里运行 Next.js 和 SvelteKit 开发服务器。',
    },
  } } },
  es: { blog: { posts: {
    [SLUG]: {
      title: 'Los cambios llegan mientras miras: actualizaciones en caliente, hojas de estilo reales y los frameworks que ya usas',
      description: 'La app que construyes en un lienzo de Builderforce ahora se actualiza en su sitio mientras editas, conservando lo que escribiste y dónde estabas. Compila Sass, SCSS y Less, aísla de verdad los CSS Modules, carga las hojas de estilo de tus paquetes y ejecuta servidores de desarrollo de Next.js y SvelteKit en el navegador.',
    },
  } } },
  fr: { blog: { posts: {
    [SLUG]: {
      title: 'Vos modifications arrivent sous vos yeux : mises à jour à chaud, vraies feuilles de style et les frameworks que vous utilisez déjà',
      description: 'L\'app que vous construisez sur un canvas Builderforce se met désormais à jour sur place pendant que vous éditez, en gardant ce que vous avez saisi et votre position de défilement. Elle compile Sass, SCSS et Less, isole réellement les CSS Modules, charge les feuilles de style de vos paquets et exécute des serveurs de développement Next.js et SvelteKit dans le navigateur.',
    },
  } } },
  de: { blog: { posts: {
    [SLUG]: {
      title: 'Änderungen kommen an, während Sie zusehen – Hot Updates, echte Stylesheets und die Frameworks, die Sie schon nutzen',
      description: 'Die App, die Sie auf einem Builderforce-Canvas bauen, aktualisiert sich jetzt beim Bearbeiten an Ort und Stelle und behält, was Sie eingegeben haben und wohin Sie gescrollt haben. Sie kompiliert Sass, SCSS und Less, kapselt CSS Modules wirklich, lädt die Stylesheets Ihrer Pakete und startet Next.js- und SvelteKit-Entwicklungsserver im Browser.',
    },
  } } },
};
