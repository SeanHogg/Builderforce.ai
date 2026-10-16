Les parties de Builderforce qui s'exécutent sur votre machine ou dans votre navigateur sont celles que vous devriez pouvoir lire. Elles touchent vos fichiers, vos clés, vos modèles et les sessions de vos utilisateurs. « Faites-nous confiance » est une mauvaise réponse pour tout cela ; la bonne réponse, c'est le code source.

C'est pourquoi les runtimes sur lesquels Builderforce est construit sont open source sous licence MIT. Il y en a quatre, et chacun est ce que le produit exécute réellement, pas une démo découpée dedans. Les deux bibliothèques ne demandent aucun compte ; les deux apps de bureau se connectent à Builderforce pour les parties qui vivent dans le cloud. Vous trouverez les quatre sur [builderforce.ai/open-source](/open-source).

```bf-figure
{
  "kind": "stack",
  "title": "Quatre projets, une plateforme au-dessus",
  "bands": [
    { "label": "BuilderForce WebContainers", "note": "Un runtime de développement dans le navigateur : aperçu, build, vérification de types, Node, npm et un shell, sans COOP/COEP ni plafond de sessions.", "hue": "make", "tag": "TypeScript · npm" },
    { "label": "BuilderForce Memory", "note": "Une mémoire SSM persistante et entraînable dans le navigateur pour n'importe quel agent, un cache sémantique qui réduit la dépense en tokens, et un serveur MCP.", "hue": "idea", "tag": "TypeScript · npm" },
    { "label": "BuilderForce Inference", "note": "Synapse, l'app de bureau, et bfi, un moteur natif qui exécute des modèles sur votre propre machine.", "hue": "run", "tag": "Rust" },
    { "label": "BuilderForce Spawn", "note": "Créer des jeux Roblox en parlant : une app de bureau et un pont vers Roblox Studio.", "hue": "reach", "tag": "Rust" }
  ],
  "caption": "Les quatre sont sous MIT. Les bibliothèques ne demandent aucun compte ; les apps de bureau se connectent pour les parties cloud."
}
```

## BuilderForce WebContainers — le runtime sous chaque aperçu

**Ce que c'est.** Un runtime de développement dans le navigateur, ouvert et forkable. Donnez-lui un projet sous forme de fichiers et il sert un aperçu en direct : Vite avec React, Vue ou Svelte, Create React App et les sites statiques. Il construit pour le déploiement (`runtime.build()`) et vérifie les types (`createChecker()`) dans la page, et exécute des programmes Node, `npm install` depuis le vrai registre et un shell interactif, avec un Web Worker par processus.

**Ce qu'il vaut.** Il lui faut un contexte sécurisé et un service worker, rien d'autre. Sans en-têtes COOP/COEP, les fenêtres de connexion, les cadres de paiement et les intégrations de votre app continuent de fonctionner. Sans plafond de sessions, ouvrir un aperçu ne coûte rien. Avec des ports interchangeables, vous pouvez remplacer le compilateur ou le CDN de paquets sans forker le cœur. Il a remplacé StackBlitz WebContainers sous chaque aperçu de canvas, chaque Publier et chaque Vérifier de Builderforce.

**Clair sur ses limites.** Les modules natifs, les scripts d'installation et les serveurs de développement de Next.js, Nuxt, SvelteKit, Remix et Astro ne tournent pas ; le runtime détecte ces projets et explique pourquoi. Les WebSockets et les réponses en streaming sont sur la feuille de route.

[Lire la page du projet](/open-source/builderforce-webcontainers) · [Lire l'annonce](/blog/builderforce-webcontainers-open-source) · [GitHub](https://github.com/SeanHogg/builderforce-webcontainers)

## BuilderForce Memory — une mémoire que n'importe quel agent peut garder

**Ce que c'est.** Un framework pour donner à n'importe quel agent d'IA une mémoire persistante entraînable dans le navigateur. Trois paquets : un moteur de noyaux d'espace d'états Mamba en WebGPU, avec entraîneur et tokenizer (`@seanhogg/builderforce-memory-engine`) ; un runtime avec des ponts Anthropic, OpenAI et Fetch, un routeur d'inférence, de la distillation en ligne et le magasin de mémoire (`@seanhogg/builderforce-memory`) ; et un serveur MCP avec un installateur qui l'enregistre dans Claude Code, Claude Desktop, Cursor, Windsurf, VS Code, Cline, Gemini CLI et Codex CLI (`@seanhogg/builderforce-memory-mcp`).

**Ce qu'il vaut.** Des factures de tokens plus basses et un savoir qui reste à jour. Un cache sémantique réutilise une réponse quand un nouveau prompt reformule une question déjà traitée : le modèle de pointe n'est même pas appelé. La cognition write-through remplace un fait périmé quand un fait plus récent est étayé par des preuves, au lieu d'empiler les deux en attendant que quelqu'un les réconcilie. C'est la couche mémoire d'Evermind sur Builderforce, et elle est indépendante du fournisseur : elle est tout aussi utile sous un agent qui n'a jamais entendu parler de nous.

[Lire la page du projet](/open-source/builderforce-memory) · [GitHub](https://github.com/SeanHogg/builderforce-memory)

## BuilderForce Inference — des modèles sur votre propre machine

**Ce que c'est.** Synapse, l'app de bureau de Builderforce, et le runtime d'IA local en dessous. `bfi` est un moteur natif écrit en Rust qui lit les modèles GGUF, sert des API HTTP compatibles OpenAI, Anthropic et Ollama, et tourne sur votre matériel. Synapse le supervise : Ollama n'est pas nécessaire. Le même espace de travail contient un index de code, un hôte MCP pour les connecteurs, un client de mémoire Evermind et des secrets conservés dans le magasin d'identifiants du système d'exploitation.

**Ce qu'il vaut.** Le travail privé reste privé. Les modèles locaux répondent à votre éditeur et à vos scripts sans appel réseau, et ce qu'Evermind apprend sur votre machine y reste, sauf si vous le publiez. Le chemin CPU est disponible aujourd'hui ; nous n'avons pas revendiqué la parité GPU avec llama.cpp, et le README le dit.

[Lire la page du projet](/open-source/builderforce-inference) · [GitHub](https://github.com/SeanHogg/builderforce-inference)

## BuilderForce Spawn — des jeux Roblox en parlant

**Ce que c'est.** Spawn, une app de bureau pour les créateurs Roblox, et le pont qui la relie à Roblox Studio. Décrivez le jeu, et il construit les pièces, le Luau et l'interface dans Studio. Il se connecte à Builderforce via le client partagé de BuilderForce Inference.

**Ce qu'il vaut.** Une seule chose à installer, au lieu d'une app, d'un plugin, d'un serveur local et d'un outil de synchronisation. Et comme il est ouvert, les parents, les écoles et les créateurs qui veulent savoir exactement ce que fait un outil de création pour jeunes créateurs peuvent le lire.

[Lire la page du projet](/open-source/builderforce-spawn) · [GitHub](https://github.com/SeanHogg/builderforce-spawn)

## Seul ou sur Builderforce

```bf-figure
{
  "kind": "compare",
  "title": "Le même code, deux façons de l'utiliser",
  "columns": [
    { "title": "Seul", "hue": "muted", "items": ["Installez-le depuis npm ou cargo, ou clonez-le depuis GitHub", "MIT : forkez-le, livrez-le, vendez-le", "Lisez chaque ligne qui tourne de votre côté", "Hébergez-le vous-même, le résultat vous appartient"] },
    { "title": "Sur Builderforce", "hue": "make", "items": ["Déjà branché au canvas, à Studio, au Brain et à l'app de bureau", "Agents, tableaux, approbations et marketplace par-dessus", "Une mémoire partagée entre votre app web, vos agents et votre machine", "Publiez à votre propre adresse en une étape"] }
  ],
  "caption": "Ici, l'open source n'est pas une version d'essai. Le code sur GitHub est le code que le produit exécute."
}
```

## Sa place dans la méthode

Le travail sur Builderforce suit un arc, **Idea → Make → Run → Measure**, et chaque acte passe par la même boucle interne : [Read, Prove, Build](/blog/read-prove-build-the-inner-loop). Chaque projet en porte une partie différente.

- **Make** tourne sur BuilderForce WebContainers. Une idée devient une app qui tourne dans l'onglet, et **Prove** reste gratuit parce que démarrer un prototype ne coûte rien.
- **Run** arrive sur votre machine avec BuilderForce Inference. Un modèle exécuté en local répond sans compteur : laisser tourner un agent devient une question de temps, pas d'argent.
- **Measure** nourrit BuilderForce Memory. Ce qui a fonctionné est retenu, une question répétée trouve sa réponse en mémoire, et la prochaine **Idea** part de ce que la précédente a appris.
- **Make** pour les jeux, c'est Spawn : la même boucle, dans Roblox Studio.

Être open source ne change pas la méthode. Cela change qui peut vérifier le travail : chaque acte qui s'exécute de votre côté exécute du code que vous pouvez lire.

## Par où commencer

- Parcourez les quatre sur [builderforce.ai/open-source](/open-source).
- Intégrez le runtime : `npm install @seanhogg/builderforce-webcontainers`.
- Donnez une mémoire à votre agent : `npm install @seanhogg/builderforce-memory`, ou installez le serveur MCP dans les outils que vous utilisez déjà.
- Exécutez des modèles en local : `cargo install --git https://github.com/SeanHogg/builderforce-inference bfi`.
- Ouvrez une issue ou envoyez une pull request. Chaque dépôt tient une feuille de route de la suite.

---

**À lire aussi :** [BuilderForce WebContainers est open source](/blog/builderforce-webcontainers-open-source) · [Synapse exécute désormais les modèles lui-même](/blog/synapse-runs-models-itself) · [Spawn — créer des jeux Roblox en parlant](/blog/build-roblox-games-by-talking)

[Ouvrez un canvas](/create) et voyez le runtime à l'œuvre.
