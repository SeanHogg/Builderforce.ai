// Catalog title/description for the two open-source blog posts, `blog.posts.<slug>.*`,
// the convention `src/lib/blogLocale.ts` reads. The English entries mirror each post's
// front matter exactly (asserted by `blogLocale.test.ts`); the other four match the
// translated bodies published beside them.
// Usage: node scripts/i18n-merge.mjs scripts/i18n-patch-open-source-blog-posts.mjs

const RUNTIME = 'builderforce-webcontainers-open-source';
const OPEN_SOURCE = 'open-source-at-builderforce';

export const PATCHES = {
  en: { blog: { posts: {
    [RUNTIME]: {
      title: 'BuilderForce WebContainers is open source — the in-browser dev runtime you can fork',
      description: 'The runtime behind every Builderforce canvas preview, Publish and Check is now MIT on GitHub and npm. It previews, builds and type-checks Vite, React, Vue and Svelte apps and runs Node, npm and a shell in the tab, with no COOP/COEP headers and no session caps.',
    },
    [OPEN_SOURCE]: {
      title: 'Open source at Builderforce — four projects you can run, read and fork',
      description: 'Builderforce stands on four MIT projects anyone can use without us. An in-browser dev runtime, browser-trainable agent memory, a local inference engine with its desktop app, and a Roblox game builder. What each one does, and what it is worth to you.',
    },
  } } },
  zh: { blog: { posts: {
    [RUNTIME]: {
      title: 'BuilderForce WebContainers 开源了——一个可以复刻的浏览器内开发运行时',
      description: 'Builderforce 每个画布预览、发布和检查背后的运行时，现在以 MIT 许可发布在 GitHub 和 npm 上。它能在标签页里预览、构建 Vite、React、Vue 和 Svelte 应用并做类型检查，还能运行 Node、npm 和 shell，无需 COOP/COEP 响应头，也没有会话上限。',
    },
    [OPEN_SOURCE]: {
      title: 'Builderforce 的开源项目——四个你可以运行、阅读和复刻的项目',
      description: 'Builderforce 构建在四个任何人都能脱离我们使用的 MIT 项目之上：一个浏览器内开发运行时、可在浏览器中训练的智能体记忆、一个本地推理引擎及其桌面应用，以及一个 Roblox 游戏构建器。每个项目做什么，对你有什么价值。',
    },
  } } },
  es: { blog: { posts: {
    [RUNTIME]: {
      title: 'BuilderForce WebContainers es código abierto: el runtime de desarrollo en el navegador con el que puedes hacer un fork',
      description: 'El runtime que hay detrás de cada vista previa del lienzo, cada Publicar y cada Comprobar de Builderforce ya es MIT en GitHub y npm. Previsualiza, compila y comprueba los tipos de apps Vite, React, Vue y Svelte, y ejecuta Node, npm y una shell en la pestaña, sin cabeceras COOP/COEP y sin límite de sesiones.',
    },
    [OPEN_SOURCE]: {
      title: 'Código abierto en Builderforce: cuatro proyectos que puedes ejecutar, leer y modificar',
      description: 'Builderforce se apoya en cuatro proyectos MIT que cualquiera puede usar sin nosotros: un runtime de desarrollo en el navegador, memoria para agentes entrenable en el navegador, un motor de inferencia local con su app de escritorio y un constructor de juegos de Roblox. Qué hace cada uno y qué te aporta.',
    },
  } } },
  fr: { blog: { posts: {
    [RUNTIME]: {
      title: 'BuilderForce WebContainers est open source — le runtime de développement dans le navigateur que vous pouvez forker',
      description: 'Le runtime derrière chaque aperçu de canvas, chaque Publier et chaque Vérifier de Builderforce est désormais sous MIT sur GitHub et npm. Il prévisualise, construit et vérifie les types des apps Vite, React, Vue et Svelte, et exécute Node, npm et un shell dans l\'onglet, sans en-têtes COOP/COEP ni plafond de sessions.',
    },
    [OPEN_SOURCE]: {
      title: 'L\'open source chez Builderforce — quatre projets à exécuter, lire et forker',
      description: 'Builderforce repose sur quatre projets MIT que chacun peut utiliser sans nous : un runtime de développement dans le navigateur, une mémoire d\'agent entraînable dans le navigateur, un moteur d\'inférence local avec son app de bureau, et un créateur de jeux Roblox. Ce que fait chacun, et ce qu\'il vous apporte.',
    },
  } } },
  de: { blog: { posts: {
    [RUNTIME]: {
      title: 'BuilderForce WebContainers ist Open Source — die Entwicklungs-Runtime im Browser, die Sie forken können',
      description: 'Die Runtime hinter jeder Canvas-Vorschau, jedem Veröffentlichen und jedem Prüfen auf Builderforce steht jetzt unter MIT auf GitHub und npm. Sie zeigt Vite-, React-, Vue- und Svelte-Apps in der Vorschau, baut sie und prüft ihre Typen, und sie führt Node, npm und eine Shell im Tab aus, ohne COOP/COEP-Header und ohne Session-Limits.',
    },
    [OPEN_SOURCE]: {
      title: 'Open Source bei Builderforce — vier Projekte, die Sie ausführen, lesen und forken können',
      description: 'Builderforce steht auf vier MIT-Projekten, die jeder ohne uns nutzen kann: eine Entwicklungs-Runtime im Browser, im Browser trainierbares Agenten-Gedächtnis, eine lokale Inferenz-Engine mit Desktop-App und ein Roblox-Spielebaukasten. Was jedes davon tut und was es Ihnen bringt.',
    },
  } } },
};
