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

C'est la fonctionnalité phare du guide, et c'est désormais un backend à part entière dans Builderforce. Notre `PromptApiModelProvider` encapsule l'API `LanguageModel` de Chrome — **aucun téléchargement** pour l'application (le modèle est livré avec le navigateur), aucun budget de VRAM à gérer, et un **véritable streaming de tokens** prêt à l'emploi :

```ts
import { createInferenceProvider } from '@/lib/model-provider';

const ai = createInferenceProvider({
  projectId,
  systemPrompt: 'You are a concise coding assistant.',
});
await ai.init();

// Streams tokens the instant the built-in model produces them.
await ai.stream('Refactor this function', context, (token) => {
  append(token);
});
```

Le provider détecte la présence de l'API, gère les états `downloadable`/`downloading`/`available` signalés par le navigateur, et expose le **budget de tokens** restant de la session (`inputUsage` / `inputQuota`) afin que les appelants puissent élaguer l'historique *avant* que la fenêtre de contexte, de taille fixe, ne soit saturée.

## 4. La cascade d'amélioration progressive

L'idée la plus importante du guide est architecturale : **une interface, plusieurs backends, un repli en douceur**. C'est exactement ce que renvoie `createInferenceProvider` — un unique `ModelProvider` qui ordonne en interne :

1. **La Prompt API de Chrome** (locale, sans configuration) — quand le navigateur l'expose
2. **Votre modèle sur l'appareil** (un SSM Mamba entraîné, éventuellement hébergé dans un worker) — quand vous en avez un
3. **Un LLM cloud** — toujours disponible, le repli final

`init()` choisit le backend prioritaire qui devient prêt ; `generate` et `stream` y sont routés et **basculent de façon transparente** vers le niveau prêt suivant en cas d'erreur. La décision « quel backend ? » se prend en un seul endroit. Votre interface parle simplement à un `ModelProvider` et ne se ramifie jamais elle-même selon la disponibilité.

## 5. Isolation dans un Web Worker

Le guide a raison : la génération ne doit jamais bloquer le thread principal — échantillonner un vecteur de logits de 150 000 entrées *à chaque token* fera saccader l'interface. Tout le moteur peut donc s'exécuter dans un **Web Worker**. Comme un `GPUDevice` ne peut pas franchir la frontière du worker, c'est le worker qui héberge entièrement le moteur, et le thread principal lui parle via un petit protocole RPC :

```ts
import { createLocalFirstProvider } from '@/lib/mamba-worker-client';

const ai = createLocalFirstProvider({
  projectId,
  includeLocalMamba: true, // Tier 2 runs entirely in a Web Worker
});
await ai.init();
```

Les tokens et les événements de progression par epoch remontent sous forme de messages ; le checkpoint entraîné est **transféré** (et non copié) vers le thread principal. Et si le runtime ne peut pas lancer de worker, le provider se déclare non prêt et la cascade passe simplement au niveau suivant — rien ne casse.

## 6. Reprise après `GPUDevice.lost`

Un onglet passé en arrière-plan, une réinitialisation du pilote ou un portable qui change de GPU invalident silencieusement chaque buffer et chaque pipeline que vous détenez. Le guide le signale ; la plupart des démos dans le navigateur l'ignorent. Builderforce s'abonne à la promesse de perte du device à l'unique point où celui-ci est acquis. Une perte réelle démonte le modèle et fait repasser le provider à l'état *non prêt*, de sorte que l'appel suivant réinitialise proprement — tandis qu'un `destroy()` volontaire est filtré pour ne jamais être interprété comme une panne.

## 7. Cache des poids, téléchargements en streaming et confidentialité

Les poids du modèle sont mis en cache dans **IndexedDB** après le premier téléchargement, à partir d'une chaîne multi-sources (notre proxy R2 → le CDN de Hugging Face) avec une progression en streaming — un checkpoint de plusieurs gigaoctets se télécharge donc une seule fois, et non à chaque chargement de page. Quant à la propriété de confidentialité que le guide décrit comme « un fait architectural », c'est exactement pour elle que nous avons construit tout cela : avec l'inférence locale, **vos prompts et votre code ne quittent jamais la machine**. Ce n'est pas une promesse contractuelle ; la requête réseau n'a tout simplement pas lieu.

## Bilan : la check-list du guide face à Builderforce

| Bonne pratique du guide | Builderforce |
| --- | --- |
| Compute shaders WebGPU | ✅ Kernels WGSL Mamba SSM écrits à la main |
| Tokenisation/échantillonnage en WASM | ✅ Tokenizer BPE, entraîné sur votre propre corpus |
| Prompt API de Chrome (niveau 1) | ✅ `PromptApiModelProvider`, véritable streaming |
| Web-LLM / WebGPU (niveau 2) | ✅ Mamba sur l'appareil, éventuellement hébergé dans un worker |
| Repli sur le cloud (niveau 3) | ✅ Niveau final de la cascade |
| Interface unique + repli | ✅ `createInferenceProvider` |
| Isolation dans un Web Worker | ✅ Moteur complet hébergé dans un worker |
| Reprise après `GPUDevice.lost` | ✅ Gestion de la perte du device en un point unique |
| Cache local des poids | ✅ IndexedDB, streaming, multi-sources |
| Tout détecter par feature detection | ✅ Sonde WebNN → WebGPU → CPU |
| ***Entraînement* sur l'appareil** | ✅ **Au-delà du guide** — véritable passe arrière + AdamW |
| **NPU via WebNN** | ✅ **Au-delà du guide** |
| **Cache sémantique des réponses** | ✅ **Au-delà du guide** — embeddings SSM sur l'appareil |

## Comment l'utiliser

Chacun des éléments ci-dessus est disponible dès aujourd'hui :

- **Les surfaces de chat et d'assistant** appellent `createInferenceProvider({ projectId })` et bénéficient gratuitement de la cascade local-first — Gemini Nano quand le navigateur le propose, le cloud sinon, en une seule ligne de code.
- **Les travaux sensibles en matière de confidentialité** activent `includeLocalMamba` pour que l'inférence reste entièrement sur l'appareil, dans un Web Worker.
- **Le fine-tuning** se fait dans le [panneau Entraînement IA](/training) : pointez-le vers votre code, et une véritable descente de gradient WebGPU produit un checkpoint qui ne touche jamais un serveur.

Le guide de SitePoint est la bonne carte. Builderforce est une plateforme qui a déjà parcouru tout le territoire — et qui a continué, jusqu'à l'entraînement sur l'appareil, ce que le navigateur n'était, jusqu'à récemment, jamais censé pouvoir faire.

*Envie de la version technique approfondie ? Lisez [Au cœur de l'architecture Evermind](/blog/inside-evermind-architecture) et [Le fine-tuning LoRA WebGPU expliqué](/blog/webgpu-lora-explained).*
