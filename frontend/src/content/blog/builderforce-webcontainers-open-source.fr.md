Chaque app que vous construisez sur un canvas Builderforce s'exécute dans votre navigateur avant de s'exécuter où que ce soit ailleurs. Jusqu'à ce mois-ci, ce qui l'exécutait ne nous appartenait pas.

Nous utilisions StackBlitz WebContainers (`@webcontainer/api`). C'est une technologie impressionnante, et c'était la bonne façon de commencer. Elle venait aussi avec quatre contraintes, de plus en plus pesantes à mesure que le canvas en faisait davantage :

- **Une licence propriétaire.** L'offre gratuite est non commerciale et exige une attribution. Un runtime placé sous un produit commercial nécessite un accord commercial, et chaque client qui voulait s'auto-héberger héritait de la question.
- **L'isolation cross-origin.** Elle exige que la page hôte soit servie avec les en-têtes COOP et COEP. Ce sont précisément ces en-têtes qui cassent ce qu'une vraie app intègre : fenêtres de connexion, cadres de paiement, lecteurs vidéo, analytics, et tout script tiers qui ne renvoie pas les bons en-têtes.
- **Des plafonds de sessions.** 25 000 sessions d'API par mois sur l'offre gratuite. Un canvas qui ouvre un aperçu chaque fois que quelqu'un regarde une app consomme vite ses sessions.
- **Aucune prise.** Quand un aperçu cassait à l'intérieur du runtime, nous pouvions le signaler et attendre. Impossible de lire le code, de le corriger ou d'en faire un fork.

Nous avons donc construit le nôtre, et il est aujourd'hui open source sous licence MIT : **BuilderForce WebContainers**, sur [GitHub](https://github.com/SeanHogg/builderforce-webcontainers) et sur npm sous le nom [`@seanhogg/builderforce-webcontainers`](https://www.npmjs.com/package/@seanhogg/builderforce-webcontainers).

## Ce que vous pouvez en faire dès maintenant

Donnez-lui un projet sous forme de fichiers : il sert un aperçu en direct dans une iframe, avec TypeScript, JSX, CSS, JSON et les paquets npm qui fonctionnent comme sous Vite. Tout s'exécute dans le navigateur de l'utilisateur.

- **Prévisualiser des apps frontend.** Vite avec React, Vue ou Svelte, Create React App et les sites statiques. Une modification recharge tous les aperçus ouverts du projet ; rien à redémarrer.
- **Construire pour le déploiement dans la page.** `runtime.build()`, c'est `npm run build` sans serveur. Il renvoie un site statique empaqueté, minifié et haché par contenu, à téléverser où vous voulez.
- **Vérifier les types dans la page.** `createChecker()` exécute TypeScript dans un Web Worker selon le tsconfig du projet et renvoie les diagnostics sous forme de données simples.
- **Exécuter des programmes Node.** `npm install` depuis le vrai registre npm, des scripts Node, des serveurs façon Express sur des ports virtuels, et un shell interactif `bfsh` pour un terminal. Chaque processus a son propre Web Worker : une boucle infinie ne fige jamais la page et `kill()` fonctionne toujours.
- **Isoler le code non fiable.** En mode relais, les aperçus et les processus tournent sur une origine distincte : le code écrit par une IA et les paquets npm arbitraires ne partagent jamais les cookies ni le stockage de votre app.
- **En faire un fork.** Le compilateur, le CDN de paquets et le transport sont des ports. Remplacez esbuild par SWC, ou esm.sh par votre propre miroir, sans patcher le cœur.

```bf-figure
{
  "kind": "compare",
  "title": "Les deux runtimes, côte à côte",
  "columns": [
    { "title": "StackBlitz WebContainers", "hue": "muted", "items": ["Licence propriétaire ; offre gratuite non commerciale", "25 000 sessions d'API par mois sur l'offre gratuite", "Exige COOP et COEP sur la page hôte", "Compilateur et source de paquets figés", "Build et vérification de types via npm run build et tsc dans le conteneur", "Node, npm et un shell"] },
    { "title": "BuilderForce WebContainers", "hue": "make", "items": ["MIT : forkez-le, livrez-le, vendez-le", "Aucun plafond de sessions", "Aucune isolation cross-origin requise ; les intégrations continuent de fonctionner", "Ports interchangeables pour le compilateur, le CDN de paquets et le transport", "runtime.build() et createChecker() dans le navigateur", "Node, npm et un shell, un Web Worker par processus"] }
  ],
  "caption": "Ce qu'il faut au nôtre : un contexte sécurisé (https ou localhost) pour le service worker. C'est tout."
}
```

## Comment ça marche

Aucun empaquetage pendant le développement. Le runtime fonctionne comme le serveur de développement de Vite, avec un service worker à la place du réseau.

```bf-figure
{
  "kind": "flow",
  "title": "Des fichiers à un aperçu qui tourne",
  "steps": [
    { "label": "Monter", "note": "Le projet vit dans un système de fichiers virtuel dans la page. Écrire un fichier, c'est une modification ; il n'y a pas de disque.", "hue": "idea" },
    { "label": "Compiler fichier par fichier", "note": "Quand l'aperçu demande src/App.tsx, ce seul fichier est compilé avec esbuild-wasm et servi comme module ES natif.", "hue": "make" },
    { "label": "Résoudre les paquets", "note": "Les imports nus deviennent des URL esm.sh, épinglées depuis package.json et dédoublonnées : il n'y a qu'un seul React.", "hue": "make" },
    { "label": "Servir", "note": "Un service worker répond aux requêtes de l'iframe en interrogeant la page : l'aperçu se charge comme n'importe quel site.", "hue": "run", "tag": "dans l'onglet" }
  ],
  "caption": "Le démarrage est immédiat et une modification ne recompile qu'un fichier. Les navigateurs tuent les service workers inactifs ; dans ce cas, le worker demande aux pages ouvertes de se rattacher au lieu de faire échouer la requête."
}
```

Les programmes Node suivent un autre chemin. `runtime.run('node', …)` démarre un Web Worker avec un instantané des fichiers et des shims pour `fs`, `http`, `child_process` et le reste des modules de base de Node ; les écritures se synchronisent avec tous les autres processus. Un serveur qui appelle `listen(3000)` reçoit ses requêtes par le même service worker, et `onServerListening` transmet son URL à l'hôte. Chaque processus est rendu sous forme de `RuntimeProcess` : un flux de sortie combiné, `stdin`, `wait()` pour le code de sortie, `kill()` et `resizeTerminal()`.

## Ce qu'il fait tourner sur Builderforce

```bf-figure
{
  "kind": "screen",
  "frame": "Une app sur le canvas, propulsée par BuilderForce WebContainers",
  "ratio": 1.62,
  "regions": [
    { "label": "Aperçu", "note": "Servi depuis preview.builderforce.ai, isolé de votre session", "x": 4, "y": 8, "w": 58, "h": 62, "hue": "make" },
    { "label": "Terminal", "note": "bfsh : npm, npx, node, pipes", "x": 4, "y": 74, "w": 58, "h": 20, "hue": "run" },
    { "label": "Vérifier", "note": "Types, build, lint, avec les échecs envoyés à l'agent", "x": 65, "y": 8, "w": 31, "h": 40, "hue": "prove" },
    { "label": "Publier", "note": "runtime.build() vers un site statique à votre adresse", "x": 65, "y": 52, "w": 31, "h": 42, "hue": "accent" }
  ],
  "caption": "Un seul runtime derrière les quatre. Rien ici ne demande au navigateur d'isolation cross-origin : l'app que vous prévisualisez se comporte comme celle que vous livrez."
}
```

- **Les aperçus du canvas.** La surface app et Studio exécutent chaque projet avec lui, en mode relais : l'aperçu vit sur `preview.builderforce.ai`, une origine distincte, donc le code écrit par un agent ne touche jamais vos cookies ni votre stockage Builderforce.
- **Publier.** Publier construit le site dans votre navigateur à partir des fichiers du projet, puis téléverse le résultat statique sur votre sous-domaine. L'aperçu, et tout ce qui y est monté, reste intact.
- **Vérifier.** Vérifier contrôle les types et construit le projet à partir de ses fichiers sans installation, puis exécute le `npm run lint` du projet sur le runtime Node s'il en a un. Chaque étape en échec retourne à l'agent comme quelque chose à corriger.
- **Les erreurs.** Les erreurs non interceptées dans l'aperçu sont envoyées à la page hôte : une app cassée revient ainsi à l'assistant qui l'a écrite, au lieu de rester là avec l'air d'être terminée.

## Ce qu'il ne fait pas encore

Nous préférons le dire plutôt que vous le laisser découvrir :

- **Modules natifs et scripts d'installation.** Les modules `.node` ne peuvent pas se charger dans un navigateur, et `postinstall` est ignoré. Les paquets dotés d'une alternative WebAssembly (esbuild-wasm, @swc/wasm) fonctionnent ; ceux qui ne livrent que des binaires natifs (sharp, better-sqlite3) non.
- **Les serveurs de développement de Next.js, Nuxt, SvelteKit, Remix et Astro.** Ils exigent aujourd'hui des binaires natifs. Le runtime détecte ces projets et les décline en expliquant pourquoi, pour que l'hôte puisse se rabattre sur un autre runtime au lieu d'afficher un aperçu cassé.
- **Les WebSockets et les réponses en streaming** depuis un serveur à l'intérieur du runtime. Pour l'instant, les réponses sont mises en mémoire tampon en entier.
- **`execSync` et `spawnSync`.** Bloquer un worker sur un autre exigerait l'isolation cross-origin, que ce runtime refuse d'imposer.

Chacun de ces points figure dans la [feuille de route](https://github.com/SeanHogg/builderforce-webcontainers/blob/main/ROADMAP.md) publique, à peu près dans l'ordre où il vaut la peine de les traiter.

## Démarrage rapide

Servez le service worker du paquet à `/__bfwc/sw.js`, puis démarrez, montez et prévisualisez :

```ts
import { startPreviewRuntime } from '@seanhogg/builderforce-webcontainers';

const runtime = await startPreviewRuntime({ serviceWorkerUrl: '/__bfwc/sw.js', id: 'my-project' });
runtime.writeTree({
  'package.json': JSON.stringify({ dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' } }),
  'index.html': '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
  'src/main.tsx': `import { createRoot } from 'react-dom/client';
createRoot(document.getElementById('root')!).render(<h1>Hello</h1>);`,
});

if (runtime.profile().supported) iframe.src = runtime.url;
runtime.onError((e) => console.warn('preview crashed:', e.message));

// Ship it: a static site with hashed assets, built in the page.
const { files } = await runtime.build({ base: './' });
```

Si le code que vous prévisualisez est écrit par une IA ou embarque des paquets arbitraires, servez les fichiers de relais depuis une origine distincte et passez `relayUrl` au lieu de `serviceWorkerUrl`. Le [README](https://github.com/SeanHogg/builderforce-webcontainers#readme) couvre le mode relais, la vérification de types, Vue et Svelte, et le runtime Node.

Chaque aperçu affiche un petit badge « Built with Builderforce.ai ». Ce n'est pas une condition de la licence, et `attribution: false` le désactive. Si le runtime vous fait économiser de l'argent, le laisser affiché, c'est ce qui finance le projet.

## Sa place dans la méthode

Le travail sur Builderforce suit un arc, **Idea → Make → Run → Measure**, et chaque acte passe par la même boucle interne : [Read, Prove, Build](/blog/read-prove-build-the-inner-loop).

```bf-figure
{
  "kind": "flow",
  "title": "Un runtime, trois actes de l'arc",
  "steps": [
    { "label": "Make", "note": "L'aperçu dans l'onglet : une modification recompile un fichier et tous les aperçus ouverts se rechargent.", "hue": "make" },
    { "label": "Vérifier", "note": "Types, build et lint avant toute livraison, avec les échecs renvoyés à l'agent.", "hue": "prove" },
    { "label": "Run", "note": "Publier construit dans le navigateur et place un site statique à votre adresse.", "hue": "run" },
    { "label": "Measure", "note": "Les erreurs de l'aperçu remontent à la page : la première preuve arrive avant le premier utilisateur.", "hue": "measure" }
  ],
  "caption": "Démarrer le runtime ne coûte rien, et c'est ce qui garde Prove bon marché : un prototype qui tourne, ce sont quelques secondes dans l'onglet, pas un conteneur."
}
```

Le runtime vit dans **Make**, et il change la façon dont **Prove** se vit. Prouver une idée avec un prototype qui tourne voulait dire attendre un conteneur ou un déploiement. Désormais, le prototype démarre dans l'onglet, ne coûte rien à faire tourner et n'a pas de compteur de sessions : essayer la deuxième idée coûte aussi peu que la première.

**Build** gagne un portail. Vérifier exécute la même vérification de types et le même build que Publier : le passage de **Make** à **Run** devient un résultat que vous pouvez lire, pas un espoir.

Et comme le runtime est sous MIT, rien de tout cela n'est une dépendance opaque. Si un aperçu se comporte mal, le code qui l'a exécuté est sur GitHub.

## Ce que vous pouvez en faire aujourd'hui

- **Construisez une app sur le canvas** et regardez-la tourner dans l'onglet, sans en-têtes à configurer ni installation.
- **Intégrez le runtime dans votre propre produit.** Un paquet, un service worker, MIT.
- **Exécutez Node dans l'onglet.** `runtime.run('npm', ['install'])`, puis `node server.js` ; `onServerListening` vous donne l'URL à afficher dans l'iframe.
- **Lisez la feuille de route et envoyez une pull request.** Ensuite : lint dans le worker de vérification, remplacement de modules à chaud et préprocesseurs de styles.

---

**À lire aussi :** [L'open source chez Builderforce](/blog/open-source-at-builderforce) · [L'app de votre canvas est maintenant un vrai projet](/blog/your-canvas-app-is-a-real-project) · [L'IDE dans le navigateur](/blog/in-browser-ide-and-collaboration)

[Découvrez tout ce que nous publions en open source](/open-source) ou [lisez la page du runtime](/open-source/builderforce-webcontainers).
