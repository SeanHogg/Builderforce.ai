SitePoint a récemment publié un excellent plan pour exécuter des grands modèles de langage entièrement dans le navigateur : [*Local-First AI With WebGPU: A Practical Guide for Chrome*](https://www.sitepoint.com/local-first-ai-webgpu-chrome-guide/). C'est l'explication la plus claire que nous ayons lue de la raison *pour laquelle* l'inférence sur l'appareil est enfin viable, et de *ce qu'*une implémentation digne de la production doit absolument réussir.

Nous l'avons lu comme on relit la check-list d'un produit déjà livré. Builderforce exécute l'inférence WebGPU — et l'entraînement — dans l'onglet du navigateur depuis plus d'un an. Cet article fait donc deux choses : il parcourt l'architecture recommandée par le guide, puis montre précisément comment notre plateforme implémente chaque point de cette liste, ainsi que ce que le guide n'aborde pas.

## Le plan, en un paragraphe

Le guide soutient que trois évolutions ont rendu l'IA local-first réelle : les **petits modèles quantifiés sur 4 bits**, l'**arrivée de WebGPU en version stable dans Chrome 113**, et **Gemini Nano intégré** à Chrome, exposé via la Prompt API. L'architecture qu'il recommande répartit le travail selon les points forts du matériel — des compute shaders WebGPU (WGSL) pour la passe avant, gourmande en multiplications matricielles, et WebAssembly pour la tokenisation et l'échantillonnage — derrière une **cascade d'amélioration progressive** : Prompt API (niveau 1) → un framework WebGPU comme Web-LLM (niveau 2) → repli sur le cloud (niveau 3), le tout derrière une interface unique. Il énumère ensuite les impératifs opérationnels : exécuter l'inférence dans un **Web Worker**, préchauffer le modèle pour réduire le délai avant le premier token, **mettre en cache les poids** localement, se remettre d'un **`GPUDevice.lost`**, et tout détecter par feature detection.

C'est une excellente liste. Voici comment nous traitons chaque point.

## 1. La couche de calcul : nous livrons nos propres kernels WGSL

Le guide recommande de s'appuyer sur un framework (Web-LLM, Transformers.js) pour projeter les calculs du transformer sur les workgroups du GPU. Nous sommes descendus d'un cran. Le moteur de Builderforce embarque des **kernels WGSL écrits à la main** pour un **modèle à espace d'états** Mamba — le cœur à balayage sélectif (S6) implémenté sous forme de scan préfixe parallèle de Kogge-Stone qui s'exécute en O(log N) sur le GPU, avec un softplus numériquement stable et une discrétisation par bloqueur d'ordre zéro.

Point essentiel : nos kernels implémentent la **passe arrière**, et pas seulement la passe avant. Autrement dit, nous ne nous contentons pas d'*exécuter* un modèle sur l'appareil — nous l'**entraînons** sur l'appareil, avec de véritables pas de gradient AdamW sur votre propre code, le tout dans l'onglet. Le guide de SitePoint s'arrête à l'inférence ; c'est cette capacité qui rend possibles [l'apprentissage « memory-first »](/blog/evermind-self-updating-model) et [le fine-tuning LoRA dans le navigateur](/blog/webgpu-lora-explained).

## 2. Sélection du matériel : WebNN → WebGPU → CPU

L'article considère WebGPU comme *la* voie de calcul. Pour nous, c'est la voie du milieu parmi trois. Notre routeur de matériel sonde, par ordre de priorité :

1. **WebNN** — l'API de réseaux de neurones capable de cibler un **NPU** dédié (Snapdragon X, Apple Neural Engine, Intel AI Boost) avant même de solliciter le GPU.
2. **WebGPU** — la voie GPU haute performance sur laquelle se concentre le guide.
3. **CPU (WASM SIMD)** — le repli honnête.

Une seule sonde, une seule décision, partagée par tous les consommateurs — aucun composant ne recalcule de son côté « ce navigateur peut-il l'exécuter ? ». Et nous **n'inventons délibérément aucune valeur de VRAM** : WebGPU n'expose pas la mémoire réelle, nous renvoyons donc `null` plutôt que de confondre une limite de spécification de 2 Go avec une carte de 2 Go et d'exclure à tort un GPU de 16 Go.

## 3. Niveau 1 : Gemini Nano intégré à Chrome

C'est la fonctionnalité phare du guide, et c'est un moteur à part entière dans Builderforce. Le moteur Prompt API encapsule l'API `LanguageModel` de Chrome : **aucun téléchargement** pour l'application (le modèle est livré avec le navigateur), aucun budget VRAM à gérer et un **véritable streaming de tokens** d'emblée. Il côtoie deux moteurs qui exécutent des modèles téléchargés sur WebGPU — notre propre moteur **Bonsai** 1 bit et **WebLLM** — derrière un unique contrat `PageEngine` :

```ts
import { createPageEngineSet } from '@seanhogg/builderforce-brain-embedded';

// Bonsai, WebLLM and the Prompt API — one set per page, one fetch shim, one model store.
const engines = createPageEngineSet({
  bfiWorker: {
    create: () => new Worker(new URL('./bfi.worker.ts', import.meta.url), { type: 'module' }),
    wasmUrl: async () => (await import('@seanhogg/bfi-web/wasm-url')).bfiWasmUrl,
  },
});
```

Le moteur détecte l'API, gère les états `downloadable`/`downloading`/`available` signalés par le navigateur, et chaque moteur annonce sa véritable fenêtre de contexte : une conversation est donc ajustée *avant* d'atteindre un modèle local plus petit.

## 4. La cascade d'amélioration progressive

L'idée la plus importante du guide est architecturale : **une interface, plusieurs backends, une dégradation gracieuse**. Dans Builderforce, c'est une seule étape de routage, `createHostModelStream` — la même fonction qu'exécutent l'application web, l'extension VS Code et le panneau latéral Chrome :

```ts
import { createHostModelStream } from '@seanhogg/builderforce-brain-embedded';

const stream = createHostModelStream({
  probes: () => engines.probe(),  // what this page can run right now
  fetch: engines.fetch(),         // the engines' one transport
  cloud: () => gatewayStream,     // the terminal tier
});
```

À chaque appel, l'ordre est :

1. **Un modèle que vous avez épinglé** depuis le sélecteur « Sur cet appareil » — il s'exécute ici, point
2. **Le local d'abord** — si un moteur prêt peut traiter la requête, il répond sur l'appareil
3. **LLM cloud** — toujours disponible, et le **repli invisible** si une tentative locale échoue

La décision « quel backend ? » vit à un seul endroit. Votre interface se contente de streamer et ne se ramifie jamais selon la disponibilité.

## 5. Isolation dans un Web Worker

Le guide a raison : le travail lourd ne doit jamais bloquer le thread principal — échantillonner sur un vecteur de logits de 150 000 entrées *par token* fait saccader l'interface. WebLLM s'exécute dans un Web Worker lorsque l'hôte en fournit un, et notre moteur **Mamba** local — celui que vous entraînez — s'exécute entièrement dans un worker. Comme un `GPUDevice` ne peut pas traverser la frontière du worker, le worker héberge tout le moteur et le thread principal lui parle via un petit protocole RPC :

```ts
import { initMambaProvider } from '@/lib/mamba-worker-client';

// Off the main thread when the runtime allows it; in-page otherwise.
const mamba = await initMambaProvider({ dModel: 512, numLayers: 8 });
await mamba.train(code, { epochs: 3, onEpochEnd: (epoch, loss) => plot(epoch, loss) });
```

Les événements de tokens et de progression par époque reviennent sous forme de messages ; le checkpoint entraîné est **transféré** (et non copié) au retour. Et si l'environnement ne peut pas créer de worker, il se rabat sur le moteur dans la page — rien ne casse.

## 6. Reprise après `GPUDevice.lost`

Un onglet passé en arrière-plan, une réinitialisation du pilote ou un portable qui change de GPU invalident silencieusement chaque buffer et chaque pipeline que vous détenez. Le guide le signale ; la plupart des démos dans le navigateur l'ignorent. Builderforce s'abonne à la promesse de perte du device à l'unique point où celui-ci est acquis. Une perte réelle démonte le modèle et fait repasser le provider à l'état *non prêt*, de sorte que l'appel suivant réinitialise proprement — tandis qu'un `destroy()` volontaire est filtré pour ne jamais être interprété comme une panne.

## 7. Cache des poids, téléchargements en streaming et confidentialité

Les poids du modèle sont mis en cache dans **IndexedDB** après le premier téléchargement, à partir d'une chaîne multi-sources (notre proxy R2 → le CDN de Hugging Face) avec une progression en streaming — un checkpoint de plusieurs gigaoctets se télécharge donc une seule fois, et non à chaque chargement de page. Quant à la propriété de confidentialité que le guide décrit comme « un fait architectural », c'est exactement pour elle que nous avons construit tout cela : avec l'inférence locale, **vos prompts et votre code ne quittent jamais la machine**. Ce n'est pas une promesse contractuelle ; la requête réseau n'a tout simplement pas lieu.

## Bilan : la check-list du guide face à Builderforce

| Bonne pratique du guide | Builderforce |
| --- | --- |
| Compute shaders WebGPU | ✅ Kernels WGSL Mamba SSM écrits à la main |
| Tokenisation/échantillonnage en WASM | ✅ Tokenizer BPE, entraîné sur votre propre corpus |
| Prompt API de Chrome (niveau 1) | ✅ Moteur Prompt API, véritable streaming |
| Web-LLM / WebGPU (niveau 2) | ✅ WebLLM et notre moteur Bonsai 1 bit, sur WebGPU |
| Repli sur le cloud (niveau 3) | ✅ Niveau final de la cascade |
| Interface unique + repli | ✅ `createHostModelStream`, une seule étape sur chaque surface |
| Isolation dans un Web Worker | ✅ WebLLM et le moteur Mamba hébergés dans des workers |
| Reprise après `GPUDevice.lost` | ✅ Gestion de la perte du device en un point unique |
| Cache local des poids | ✅ IndexedDB, streaming, multi-sources |
| Tout détecter par feature detection | ✅ Sonde WebNN → WebGPU → CPU |
| ***Entraînement* sur l'appareil** | ✅ **Au-delà du guide** — véritable passe arrière + AdamW |
| **NPU via WebNN** | ✅ **Au-delà du guide** |
| **Mémoire de réponses sur l'appareil** | ✅ **Au-delà du guide** — embeddings SSM sur l'appareil |

## Comment l'utiliser

Chacun des éléments ci-dessus est disponible dès aujourd'hui :

- **Les surfaces de chat et d'assistant** bénéficient gratuitement de la cascade local d'abord — Gemini Nano ou un modèle téléchargé depuis le sélecteur « Sur cet appareil » quand le navigateur peut l'exécuter, sinon le cloud — avec le même routage sur le web, dans VS Code et dans le panneau latéral Chrome.
- **Le travail sensible à la confidentialité** épingle un modèle sur l'appareil, pour que la requête ne quitte jamais la machine.
- **Le fine-tuning** se fait dans le [panneau Entraînement IA](/training) : pointez-le vers votre code, et une véritable descente de gradient WebGPU produit un checkpoint qui ne touche jamais un serveur.

Le guide de SitePoint est la bonne carte. Builderforce est une plateforme qui a déjà parcouru tout le territoire — et qui a continué, jusqu'à l'entraînement sur l'appareil, ce que le navigateur n'était, jusqu'à récemment, jamais censé pouvoir faire.

*Envie de la version technique approfondie ? Lisez [Au cœur de l'architecture Evermind](/blog/inside-evermind-architecture) et [Le fine-tuning LoRA WebGPU expliqué](/blog/webgpu-lora-explained).*
