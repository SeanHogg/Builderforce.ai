Configurer un environnement de développement fait partie de ces tâches qui prennent entre 20 minutes et plusieurs jours, et qui ne vous apprennent pas grand-chose. Cloner le dépôt, installer la bonne version de Node, définir les variables d'environnement, se battre avec les dépendances natives, s'apercevoir que le README a trois ans de retard.

L'IDE dans le navigateur de Builderforce supprime tout cela. Ouvrez un navigateur, ouvrez un projet, et vous voilà dans un véritable environnement Node.js — avec un système de fichiers, un gestionnaire de paquets, un serveur de développement, un terminal et un binôme IA — sans rien installer.

![Maquette d'IDE en trois volets dans le navigateur, avec un explorateur de fichiers, l'éditeur de code Monaco et un panneau droit qui bascule entre Aperçu, Terminal et Chat IA](/blog/in-browser-ide.svg)

---

## Comment ça marche : WebContainers

L'IDE repose sur **WebContainers** — un runtime Node.js basé sur WebAssembly qui s'exécute entièrement dans l'onglet du navigateur. WebContainers fournit :

- Un véritable système de fichiers compatible POSIX (en mémoire, avec persistance vers R2)
- Un runtime Node.js complet avec prise en charge des modules natifs
- La possibilité d'exécuter `npm install`, `npm run dev`, `npm test` — exactement comme en local
- Une couche réseau localhost accessible depuis le navigateur — le port 3000 de votre serveur de développement est directement accessible dans le volet d'aperçu

Ce n'est ni une simulation ni une VM distante. Le code s'exécute dans votre navigateur. Le serveur de développement tourne dans votre navigateur. Aucune ressource de calcul côté serveur n'intervient dans l'exécution elle-même.

---

## Ouvrir l'IDE

Rendez-vous sur [/ide](/ide) et sélectionnez un projet, ou ouvrez l'IDE directement depuis la page de détail d'un projet.

L'IDE adopte une disposition en trois volets :

```
┌─────────────┬──────────────────────────────┬──────────────┐
│ File        │                              │              │
│ Explorer    │  Code Editor (Monaco)        │  Preview /   │
│             │                              │  Terminal /  │
│  src/       │  // Your code here           │  AI Chat     │
│  ├ app/     │                              │              │
│  ├ api/     │                              │              │
│  └ tests/   │                              │              │
└─────────────┴──────────────────────────────┴──────────────┘
```

### Panneau gauche — Explorateur de fichiers

Parcourez, créez, renommez et supprimez des fichiers. L'arborescence reflète en direct le système de fichiers WebContainers — les modifications que vous faites dans l'éditeur apparaissent immédiatement, et celles des agents (via BuilderForce Agents) apparaissent au fur et à mesure de leur écriture.

### Panneau central — Éditeur Monaco

L'éditeur Monaco au complet — le moteur qui fait tourner VS Code. Vous bénéficiez de :

- La coloration syntaxique pour tous les langages majeurs
- Le serveur de langage TypeScript (vérification de types, autocomplétion, accès à la définition)
- Des marqueurs d'erreurs et d'avertissements en ligne
- Des onglets multi-fichiers avec indicateurs de modifications non enregistrées
- La recherche et le remplacement dans tout le projet

### Panneau droit — selon le contexte

Le panneau droit bascule entre trois vues grâce au sélecteur situé en haut :

| Vue | Contenu |
|---|---|
| **Aperçu** | Iframe en direct connectée au localhost du WebContainer ; se rafraîchit automatiquement quand votre serveur de développement recharge à chaud |
| **Terminal** | Terminal complet connecté au shell du WebContainer — exécutez n'importe quelle commande |
| **Chat IA** | Le binôme IA (voir ci-dessous) |

---

## Le binôme IA

Le panneau Chat IA est une interface conversationnelle pleinement consciente du contexte de votre projet :

- **Fichiers ouverts** — l'IA sait ce que vous regardez
- **Arborescence des fichiers** — elle comprend la structure du projet
- **Sortie du terminal** — elle voit les erreurs de votre serveur de développement ou de votre lanceur de tests
- **Historique git** — elle a accès aux commits récents

Posez-lui n'importe quelle question liée à votre travail :

> « Ce composant se re-rend trop souvent. Pouvez-vous trouver pourquoi et proposer une correction ? »

> « Écrivez un test pour l'utilitaire `parseDate` qui couvre les cas limites. »

> « L'API renvoie une 500. L'erreur est dans le terminal ci-dessus — qu'est-ce qui ne va pas ? »

L'IA peut modifier directement vos fichiers (avec votre accord), exécuter des commandes dans le terminal et expliquer ce qu'elle fait au fur et à mesure.

---

## Collaboration en temps réel

Invitez un coéquipier dans votre session IDE et vous voilà dans le même environnement, au même moment.

La collaboration repose sur **Yjs** — une bibliothèque de synchronisation en temps réel basée sur les CRDT — via un relais WebSocket Durable Object de Builderforce :

- **Présence des curseurs** — voyez où se trouve le curseur de chaque collaborateur
- **Modifications en direct** — les changements apparaissent en temps réel, sans conflit
- **Chat** — un canal de discussion latéral au sein de la session IDE
- **Terminal partagé** — les commandes lancées par un utilisateur sont visibles par tous

Il n'y a pas de « propriétaire » — chaque collaborateur dispose d'un accès égal au système de fichiers, au terminal et à l'éditeur. L'état du WebContainer sous-jacent est cohérent pour tous les participants.

Les sessions de collaboration peuvent réunir des humains et des agents. Si un agent BuilderForce Agents travaille sur le même projet, ses modifications de fichiers arrivent comme des changements en direct dans l'éditeur — vous regardez l'agent écrire du code dans la fenêtre même où vous le relisez.

---

## Connexion à BuilderForce Agents

L'IDE et BuilderForce Agents sont deux façons d'interagir avec le même projet. L'IDE est l'interface native du navigateur ; BuilderForce Agents est le runtime agentique auto-hébergé. Ils partagent :

- **Le même système de fichiers** — BuilderForce Agents synchronise son espace de travail avec Builderforce ; l'IDE lit l'état synchronisé
- **Le même tableau de tâches** — les tâches créées dans le panneau de tâches de l'IDE sont celles que BuilderForce Agents exécute
- **Le même historique de chat** — les messages que vous envoyez dans le chat de l'IDE sont relayés vers la session BuilderForce Agents active ; les réponses de BuilderForce Agents s'affichent dans le chat de l'IDE en temps réel

Autrement dit, l'IDE n'est pas qu'un éditeur de code — c'est une **fenêtre sur le travail de l'agent**. Pendant que BuilderForce Agents exécute un workflow sur votre serveur, vous pouvez voir les fichiers changer dans l'IDE, suivre le raisonnement de l'agent dans le panneau de chat et intervenir si quelque chose semble clocher — sans quitter le navigateur.

---

## Créer un projet depuis l'IDE

Pour démarrer un nouveau projet de zéro :

1. Créez un projet dans [/projects](/projects) → **Nouveau projet**
2. Choisissez un modèle (Next.js, Vite + React, Node + Express, vierge)
3. Ouvrez le projet dans l'IDE — WebContainers s'initialise, les dépendances s'installent, le serveur de développement démarre
4. Le volet d'aperçu affiche votre application en cours d'exécution

Les modèles lancent `npm install` automatiquement lors de la première initialisation du conteneur. Les ouvertures suivantes restaurent le dernier état du système de fichiers depuis R2 : votre session reprend exactement là où vous l'aviez laissée.

---

## Intégration de la gestion de code source

L'IDE intègre la prise en charge de git pour les projets dotés d'une intégration de gestion de code source :

- **Barre d'état** — affiche la branche courante et les modifications non commitées
- **Panneau de commit** — indexez, commitez et poussez sans quitter l'IDE
- **Création de PR** — ouvrez une pull request directement depuis l'IDE quand votre travail est prêt
- **Changement de branche** — basculez de branche, créez des branches de fonctionnalité, fusionnez

Les modifications commitées dans l'IDE déclenchent la synchronisation de répertoire de BuilderForce Agents — l'espace de travail local de l'AgentHost est mis à jour en conséquence, ce qui maintient l'IDE et l'état local de l'agent synchronisés.

---

## Quand utiliser l'IDE ou BuilderForce Agents

| Utilisez l'IDE | Utilisez BuilderForce Agents |
|---|---|
| Explorer et modifier directement des fichiers | Exécuter de longs workflows autonomes |
| Programmer en binôme avec l'IA sur un problème précis | Exécuter des tâches par lots sur un projet |
| Relire et approuver les diffs générés par les agents | Traiter les tâches dispatchées depuis le portail |
| Collaborer en temps réel avec vos coéquipiers | Travailler sans surveillance pendant la nuit |
| Lancer des commandes rapides dans le terminal | Faire tourner des services persistants en arrière-plan |

Les deux sont conçus pour être utilisés ensemble — démarrez une fonctionnalité dans l'IDE avec l'aide de l'IA, confiez l'implémentation à un workflow BuilderForce Agents, puis relisez les résultats dans l'IDE une fois que l'agent a terminé.

---

## Bonnes pratiques

**Gardez le volet d'aperçu ouvert pendant le travail frontend.** Le retour instantané de l'aperçu à rechargement à chaud est l'un des plus grands gains de productivité qu'apporte l'IDE dans le navigateur — ne le délaissez pas au profit du seul terminal.

**Utilisez le terminal pour les commandes ponctuelles, l'agent pour les tâches répétitives.** Si vous lancez `npm test` plus de trois fois pour déboguer le même problème, décrivez l'échec au chat IA et laissez-le mener la boucle d'itération.

**Commitez souvent dans l'IDE.** Des commits petits et fréquents vous donnent, à vous comme à BuilderForce Agents, un historique propre sur lequel raisonner. De gros ensembles de modifications non commitées désorientent les agents qui lisent l'historique git pour trouver du contexte.

**Assignez le projet de l'IDE à une instance BuilderForce Agents.** L'IDE est plus puissant quand un AgentHost y est rattaché — le chat IA du panneau droit peut alors dispatcher vers le runtime d'agent complet, et pas seulement vers le modèle intégré au navigateur.

---

## Prochaines étapes

- Ouvrez un projet dans l'[IDE](/ide) et explorez la disposition en trois volets
- Invitez un coéquipier à collaborer — partagez l'URL de la session depuis l'en-tête de l'IDE
- Lisez [BuilderForce Agents et l'intégration des agents](/blog/agents-and-agent-integration) pour comprendre comment BuilderForce Agents prolonge ce que vous construisez dans l'IDE
- Découvrez [WebGPU et l'entraînement LoRA](/blog/webgpu-lora-explained) si vous voulez affiner des modèles pour votre propre base de code, directement dans le navigateur
