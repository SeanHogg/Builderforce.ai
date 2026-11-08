# Builderforce Studio — décrivez une application, regardez-la tourner, gardez chaque version

Vous décrivez une petite application : une page de liste d’attente qui enregistre les inscriptions et vous envoie un e-mail quand quelqu’un s’inscrit. Trente secondes plus tard, vous avez une douzaine de fichiers, un serveur et un formulaire.

Ce qui se passe ensuite est la partie qui compte, et jusqu’à présent cela se passait mal de l’une de trois façons. Le projet avait besoin d’un serveur, et l’aperçu ne pouvait pas en exécuter un. Le tour suivant de l’agent cassait quelque chose qui fonctionnait une minute plus tôt, et il n’y avait aucun moyen propre de revenir en arrière. Ou bien tout fonctionnait, et vous ne saviez pas du tout où allaient les inscriptions.

**Builderforce Studio** est construit autour de ces trois moments.

## Une seule fenêtre, du prompt à l’application en marche

Ouvrez [studio.builderforce.ai](https://studio.builderforce.ai), tapez ce que vous voulez, et vous voilà dans un espace de travail avec l’agent d’un côté et l’application en marche de l’autre. Vous n’avez pas besoin de compte pour commencer à écrire. La connexion se fait dans une fenêtre contextuelle lorsqu’elle est nécessaire : le prompt que vous avez écrit est donc toujours là à votre retour.

```bf-figure
{
  "kind": "screen",
  "frame": "Un projet Studio",
  "ratio": 1.62,
  "regions": [
    { "label": "Agent", "note": "Décrivez le changement ; chaque tour devient une version", "x": 3, "y": 10, "w": 24, "h": 80, "hue": "idea" },
    { "label": "Aperçu · Code · Base de données", "note": "L’application en marche, son code source et ce qu’elle stocke", "x": 29, "y": 10, "w": 46, "h": 62, "hue": "make" },
    { "label": "Terminal · Sortie · Problèmes", "x": 29, "y": 75, "w": 46, "h": 15, "hue": "run" },
    { "label": "Fichiers · Versions · Publier", "x": 77, "y": 10, "w": 20, "h": 80, "hue": "accent" },
    { "label": "Publier · GitHub · Partager", "x": 60, "y": 2, "w": 37, "h": 6, "hue": "accent" }
  ],
  "caption": "Tout ce dont une petite application a besoin, dans une seule fenêtre : la conversation, le résultat en marche, ses fichiers et son historique, et ses données."
}
```

## Elle tourne, quel que soit le type d’application

Les aperçus couvraient auparavant des pages, pas des serveurs. Si l’agent écrivait une API Express, une application Vue ou une application Svelte, l’aperçu n’avait rien à montrer.

Désormais, l’ensemble s’exécute dans votre navigateur, sur l’environnement d’exécution propre à Builderforce. Les dépendances du projet s’installent, son serveur démarre et l’aperçu affiche ses vraies routes. Les projets Vue et Svelte s’affichent en aperçu et se publient de la même façon que les projets React. Le terminal est un vrai shell : `npm install`, `node server.js`, `ls`, `cat`.

```bf-figure
{
  "kind": "flow",
  "title": "Ce qui se passe quand vous appuyez sur Exécuter",
  "steps": [
    { "label": "Aperçu instantané", "note": "Un projet Vite, React, Vue, Svelte ou statique est servi directement depuis la mémoire, sans étape d’installation.", "hue": "make" },
    { "label": "Ou son propre serveur", "note": "Un projet avec un serveur Node exécute npm install et npm run dev, et l’aperçu suit le port qu’il ouvre.", "hue": "make" },
    { "label": "Les modifications s’appliquent en direct", "note": "Chaque changement, le vôtre ou celui de l’agent, recharge l’aperçu.", "hue": "run", "tag": "dans le navigateur" }
  ],
  "caption": "Pas de session facturée au compteur, pas de machine cloud à attendre. Le code s’exécute sur un domaine d’aperçu distinct, de sorte qu’il ne partage jamais votre connexion Builderforce."
}
```

Publier construit aussi le site dans le navigateur, avec des ressources à empreinte et une base relative, prêt à être servi sur votre sous-domaine. Vérifier contrôle les types du projet et le compile. Tout ce qui échoue est envoyé à l’agent avec l’erreur : une compilation cassée est donc corrigée plutôt que de rester là en ayant l’air terminée.

## Chaque tour est une version

Quand l’agent termine un tour, les fichiers qu’il a touchés deviennent une version : *App.tsx, Header.tsx et 2 autres modifiés*. Vous pouvez en nommer une vous-même avant de tenter quelque chose de risqué. La restauration se fait en deux clics, et elle enregistre d’abord l’endroit où vous en êtes : une restauration est donc elle-même annulable.

```bf-figure
{
  "kind": "compare",
  "title": "Quand le tour suivant casse ce qui fonctionnait",
  "columns": [
    { "title": "Avant", "hue": "muted", "items": ["Demander à l’agent de l’annuler", "Espérer qu’il se souvienne de ce qu’était « cela »", "Comparer les fichiers à l’œil", "Perdre le bon changement avec le mauvais"] },
    { "title": "Dans Studio", "hue": "make", "items": ["Ouvrir Versions", "Choisir le tour d’avant le problème", "Restaurer — l’état actuel est d’abord enregistré", "Poursuivre à partir de là"] }
  ],
  "caption": "Les versions sont enregistrées pendant que l’agent travaille, sans que vous ayez à penser à sauvegarder."
}
```

## Les données de l’application ont un endroit où vivre

Une application publiée conserve ce que les gens lui envoient. La vue **Base de données** se trouve à côté d’Aperçu et de Code :

- **Tables.** Chaque collection dans laquelle l’application écrit, avec ses lignes, son point d’accès et ses interrupteurs : ouvrir un ticket pour chaque envoi, permettre aux utilisateurs connectés de relire leurs propres lignes. Ajoutez une table, supprimez une ligne ou supprimez une table.
- **Utilisateurs.** Toutes les personnes qui se sont connectées à votre application. Elles se connectent avec un code à usage unique envoyé par e-mail : aucun mot de passe à gérer. Suspendez quelqu’un, ce qui le déconnecte partout, ou supprimez-le.
- **Fonctions serveur.** Les gestionnaires du back-end de l’application et les secrets qu’ils utilisent. Elles fonctionnent avant la publication.

Avant la première publication, la vue vous l’indique et ouvre Publier. Après, tout se remplit tout seul.

## Sa place dans la méthode

Le travail sur Builderforce suit un arc — **Idée → Réaliser → Exécuter → Mesurer** — et chaque acte passe par la même boucle intérieure : [Lire, Prouver, Construire](/blog/read-prove-build-the-inner-loop).

Studio est l’acte **Réaliser** rendu court. Une idée devient une application en marche dans la fenêtre même où vous l’avez décrite, et **Construire** cesse d’être l’étape où l’attention fuit : pas de terminal ailleurs, pas de déploiement à attendre, pas de second onglet.

Les versions gardent **Construire** honnête. Quand l’agent essaie quelque chose, vous voyez le résultat dans l’aperçu, et s’il est faux, vous revenez d’un tour en arrière. Essayer ne coûte rien, et c’est ainsi qu’une boucle devrait se vivre.

La vue Base de données est l’endroit où **Exécuter** commence. Dès que l’application est en ligne, les personnes qui l’utilisent et ce qu’elles envoient sont sur le même écran que le code qui les sert. C’est aussi la première preuve avec laquelle **Mesurer** peut travailler : qui s’est inscrit, et ce qu’il a demandé.

## Ce que vous pouvez en faire dès aujourd’hui

- **Passer d’un prompt à une application en marche**, serveur compris, sans rien installer.
- **Annuler n’importe quel tour de l’agent** en deux clics, et nommer les versions qui comptent.
- **Voir et gérer les données et les utilisateurs de votre application** à côté de son code.
- **Publier** sur votre propre sous-domaine, ou pousser vers GitHub, depuis l’en-tête.

Les serveurs de développement Next.js, Nuxt et SvelteKit ne s’exécutent pas encore dans le navigateur ; pour ceux-là, Exécuter vous en explique la raison plutôt que d’échouer en silence.
