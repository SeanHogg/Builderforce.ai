// Catalog title/description for the "your app talks back" blog post, `blog.posts.<slug>.*`,
// the convention `src/lib/blogLocale.ts` reads. The English entry mirrors the post's
// front matter exactly (asserted by `blogLocale.test.ts`); the other four match the
// translated bodies published beside it.
// Usage: node scripts/i18n-merge.mjs scripts/i18n-patch-your-app-talks-back.mjs

const SLUG = 'your-app-talks-back';

export const PATCHES = {
  en: { blog: { posts: {
    [SLUG]: {
      title: 'Your app now talks back — its console, live connections and a copy you can take with you',
      description: 'The app you build on a Builderforce canvas now shows you what it logs, keeps its live connections and logins working in the preview, comes back without reinstalling on your next visit, and downloads as a project you own.',
    },
  } } },
  zh: { blog: { posts: {
    [SLUG]: {
      title: '你的应用现在会回应你了——它的控制台、实时连接，以及一份可以带走的副本',
      description: '你在 Builderforce 画布上构建的应用，现在会向你展示它输出的日志，在预览中保持实时连接和登录正常工作，下次访问时无需重新安装即可恢复，还能作为一个归你所有的项目下载。',
    },
  } } },
  es: { blog: { posts: {
    [SLUG]: {
      title: 'Tu app ahora te responde: su consola, conexiones en vivo y una copia que puedes llevarte',
      description: 'La app que construyes en un lienzo de Builderforce ahora te muestra lo que registra, mantiene funcionando en la vista previa sus conexiones en vivo y sus inicios de sesión, vuelve sin reinstalar en tu próxima visita y se descarga como un proyecto que es tuyo.',
    },
  } } },
  fr: { blog: { posts: {
    [SLUG]: {
      title: 'Votre app vous répond désormais — sa console, ses connexions en direct et une copie à emporter',
      description: 'L\'app que vous construisez sur un canvas Builderforce vous montre désormais ce qu\'elle journalise, garde ses connexions en direct et ses sessions actives dans l\'aperçu, revient sans réinstallation à votre visite suivante et se télécharge comme un projet qui vous appartient.',
    },
  } } },
  de: { blog: { posts: {
    [SLUG]: {
      title: 'Ihre App antwortet jetzt – ihre Konsole, Live-Verbindungen und eine Kopie zum Mitnehmen',
      description: 'Die App, die Sie auf einem Builderforce-Canvas bauen, zeigt Ihnen jetzt, was sie protokolliert, hält ihre Live-Verbindungen und Logins in der Vorschau am Laufen, kommt bei Ihrem nächsten Besuch ohne Neuinstallation zurück und lässt sich als Projekt herunterladen, das Ihnen gehört.',
    },
  } } },
};
