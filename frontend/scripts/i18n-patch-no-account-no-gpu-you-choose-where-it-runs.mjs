// Catalog title/description for the "no account, no GPU — you choose where it runs" blog post,
// `blog.posts.<slug>.*`, the convention `src/lib/blogLocale.ts` reads. The English entry mirrors
// the post's front matter exactly (asserted by `blogLocale.test.ts`); the other four match the
// translated bodies published beside it.
// Usage: node scripts/i18n-merge.mjs scripts/i18n-patch-no-account-no-gpu-you-choose-where-it-runs.mjs

const SLUG = 'no-account-no-gpu-you-choose-where-it-runs';

export const PATCHES = {
  en: { blog: { posts: {
    [SLUG]: {
      title: 'No account, no GPU, no network — and you choose where every word goes',
      description: 'Studio and Rovr now open with a working model and no account, no sign-up call and no GPU required. Every surface — the web, the VS Code extension and the Rovr side panel — asks one question about where your words run: Local only, Hybrid or one Specific model. And Hybrid learns, on your device, which turns to keep local.',
    },
  } } },
  zh: { blog: { posts: {
    [SLUG]: {
      title: '无需账号、无需 GPU、无需网络——你的每一个字去往哪里，由你决定',
      description: 'Studio 和 Rovr 现在一打开就有可用的模型，无需账号、无需注册调用、无需 GPU。每个界面——网页、VS Code 扩展和 Rovr 侧边栏——都只问一个问题：你的文字在哪里运行？仅本地、混合，或某一个指定模型。混合模式还会在你的设备上学习哪些轮次该留在本地。',
    },
  } } },
  es: { blog: { posts: {
    [SLUG]: {
      title: 'Sin cuenta, sin GPU, sin red, y tú eliges adónde va cada palabra',
      description: 'Studio y Rovr ahora se abren con un modelo funcionando y sin cuenta, sin llamada de registro y sin necesidad de GPU. Cada superficie —la web, la extensión de VS Code y el panel lateral de Rovr— hace una sola pregunta sobre dónde se ejecutan tus palabras: Solo local, Híbrido o un Modelo específico. Y Híbrido aprende, en tu dispositivo, qué turnos mantener en local.',
    },
  } } },
  fr: { blog: { posts: {
    [SLUG]: {
      title: 'Sans compte, sans GPU, sans réseau — et c’est vous qui choisissez où va chaque mot',
      description: 'Studio et Rovr s’ouvrent désormais avec un modèle opérationnel, sans compte, sans appel d’inscription et sans GPU. Chaque surface — le web, l’extension VS Code et le panneau latéral Rovr — pose une seule question sur l’endroit où vos mots s’exécutent : Local uniquement, Hybride ou un Modèle spécifique. Et Hybride apprend, sur votre appareil, quels tours garder en local.',
    },
  } } },
  de: { blog: { posts: {
    [SLUG]: {
      title: 'Kein Konto, keine GPU, kein Netz – und Sie entscheiden, wohin jedes Wort geht',
      description: 'Studio und Rovr starten jetzt mit einem funktionierenden Modell – ohne Konto, ohne Registrierungsaufruf und ohne GPU. Jede Oberfläche – das Web, die VS-Code-Erweiterung und der Rovr-Seitenbereich – stellt eine einzige Frage dazu, wo Ihre Worte laufen: Nur lokal, Hybrid oder ein bestimmtes Modell. Und Hybrid lernt auf Ihrem Gerät, welche Züge lokal bleiben.',
    },
  } } },
};
