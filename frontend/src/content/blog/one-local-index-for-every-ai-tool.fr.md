Regardez un agent commencer une tâche dans un grand dépôt et comptez les appels avant sa première modification.

Il lance un grep sur un mot de votre demande. Le mot n'est pas dans le code : vous avez décrit le comportement, le code le nomme autrement. Il liste un répertoire. Il lit un fichier de 2 000 lignes pour trouver une fonction, puis la mauvaise voisine, puis relit le premier fichier parce que la fenêtre dont il avait besoin est sortie du contexte. Dix, vingt, trente appels rien que pour s'orienter, tous payés, avant que quoi que ce soit ne change.

Puis vous passez à un autre outil, et il recommence tout, parce que rien de ce qu'il a appris n'a été rangé là où un autre outil pourrait le lire.

Voilà le manque : **chaque outil d'IA que vous utilisez part de zéro, et chacun part de zéro de son côté.**

## Synapse

Synapse est une petite application qui vit dans la barre système et tient un index par dépôt — sur votre machine, à jour jusqu'à votre dernier enregistrement.

```bf-figure
{
  "kind": "flow",
  "title": "Ce que contient l'index, et qui le lit",
  "steps": [
    { "label": "Définitions", "note": "Chaque fonction, classe et type, découpés à leurs vraies frontières — l'unité qu'un agent veut réellement lire.", "hue": "idea" },
    { "label": "Une carte", "note": "Les fichiers classés selon la dépendance du reste du code envers eux, chacun avec ses signatures les plus utilisées.", "hue": "idea" },
    { "label": "Recherche par le sens", "note": "Des mots-clés qui comprennent les identifiants (« membership » trouve resolveMembership) plus des embeddings locaux, fusionnés en un seul classement.", "hue": "make" },
    { "label": "Tous les outils", "note": "L'agent VS Code, Claude Code, Cursor et tout client MCP lisent le même index.", "hue": "run", "tag": "un index" }
  ],
  "caption": "La surveillance des fichiers réindexe ce que vous enregistrez : l'index décrit le code tel qu'il est maintenant, pas tel qu'il était à la dernière analyse."
}
```

Dès que l'application tourne, trois choses changent.

**L'agent démarre orienté.** Le contexte de chaque tour contient la carte du dépôt : l'agent sait quels modules comptent avant d'en ouvrir un. Et il dispose de `semantic_search` : demandez « comment les remboursements arrivent-ils dans le grand livre ? » et la réponse est la fonction qui le fait — son chemin, sa plage de lignes, son corps — en un seul appel.

**Tous les outils le partagent.** Le même index répond à l'agent Builderforce dans VS Code et, via une seule entrée MCP, à Claude Code et à Cursor. Ce que vous configurez une fois les sert tous.

**La mémoire périmée est repérée.** C'est la partie dont nous n'attendions pas qu'elle compte autant.

## Une mémoire qui sait quand elle se trompe

Evermind retient ce que les exécutions précédentes ont appris sur votre projet : conventions, causes profondes, emplacement des choses. Cette mémoire évite que la dixième exécution redécouvre ce que la première avait déjà compris.

Elle peut aussi se tromper de la pire des façons. Un souvenir disant « les droits passent par `resolveMembership()` » était juste le jour où il a été écrit. Trois semaines plus tard, la fonction a disparu — renommée, fusionnée, supprimée — et le souvenir est toujours sûr de lui, toujours précis, et désormais faux. Un agent qui s'y fie cherche du code qui n'existe pas ou, pire, le recrée.

```bf-figure
{
  "kind": "compare",
  "title": "Le même souvenir rappelé, avant et après",
  "columns": [
    { "title": "Sans l'index", "hue": "muted", "items": ["« Utilise resolveMembership() pour les droits »", "L'agent la cherche", "Ne trouve rien, ou une vieille copie", "En écrit une nouvelle à côté du vrai code"] },
    { "title": "Avec Synapse", "hue": "make", "items": ["« Utilise resolveMembership() pour les droits »", "PEUT-ÊTRE OBSOLÈTE : resolveMembership n'existe plus", "L'agent vérifie d'abord le code actuel", "Met à jour le souvenir au lieu de lui obéir"] }
  ],
  "caption": "Chaque souvenir et chaque fait de projet rappelés sont confrontés à l'index en direct. Seuls les noms qui sont sans ambiguïté du code — chemins et identifiants — sont vérifiés : la prose ordinaire n'est jamais signalée."
}
```

Tant que l'application de bureau tourne, chaque souvenir que l'agent rappelle est confronté à l'index avant que l'agent ne le voie. Un chemin ou un symbole qui n'existe plus est joint au souvenir sous forme d'avertissement. L'agent vérifie au lieu d'obéir, et un souvenir dépassé est corrigé au lieu d'orienter discrètement le travail pendant un mois de plus.

## Tout reste sur votre machine

L'indexation, le découpage et les embeddings s'exécutent localement. Le modèle d'embeddings se télécharge une fois, l'index vit dans votre profil utilisateur — jamais dans le dépôt — et l'application n'envoie de code nulle part. Le service local qu'elle fait tourner est protégé par une clé générée à chaque démarrage que seul votre compte utilisateur peut lire, et il refuse catégoriquement les requêtes venant de pages web.

```bf-figure
{
  "kind": "screen",
  "frame": "Synapse",
  "ratio": 1.4,
  "regions": [
    { "label": "Espaces de travail indexés", "note": "Progression de l'analyse et de la vectorisation par dépôt ; réanalyser ou retirer", "x": 4, "y": 8, "w": 92, "h": 44, "hue": "idea" },
    { "label": "Connectez vos outils", "note": "VS Code est automatique ; une commande pour Claude Code ; un bloc JSON pour Cursor", "x": 4, "y": 56, "w": 92, "h": 30, "hue": "run" },
    { "label": "Reste en local", "x": 4, "y": 89, "w": 40, "h": 7, "hue": "accent" }
  ],
  "caption": "Ouvrez un dossier dans VS Code avec l'extension Builderforce : il s'enregistre tout seul, rien à configurer."
}
```

Cela compte au-delà du confort. Beaucoup d'équipes ne peuvent tout simplement pas envoyer leur code source à un index hébergé — activités réglementées, code client sous NDA, environnements isolés. Un index local fait la différence entre des agents qui connaissent leur code et pas d'agents du tout.

## Sa place dans la méthode

Tout travail sur Builderforce suit la même boucle interne : [Lire, Prouver, Construire](/blog/read-prove-build-the-inner-loop). Lire et Prouver sont gratuits à dessein : ils servent à décider si l'étape coûteuse, Construire, en vaut la peine.

Synapse est une fonction de **Lecture**, et c'est à la lecture que les agents étaient les plus faibles. Un agent qui lit mal le code ne saute pas la lecture ; il lit mal, au prix de la construction — chaque appel d'orientation facturé comme une étape de construction, chaque relecture consumant le contexte dont la vraie modification avait besoin. Rendre la lecture bon marché et exacte rend le reste de la boucle honnête : Prouver travaille sur le vrai code, et Construire commence dans le bon fichier.

La vérification de la mémoire périmée comble un manque plus discret dans la même étape. Lire, c'est aussi relire ce que l'on sait déjà — et un souvenir n'est un savoir que tant qu'il reste vrai.

## Ce que vous pouvez faire dès aujourd'hui

- **Lancer un agent sur une zone inconnue** et le laisser trouver la fonction en décrivant ce qu'elle fait, au lieu d'en deviner le nom.
- **Utiliser Claude Code et Cursor sur le même index** que l'agent Builderforce — ajoutez-le une fois depuis le panneau Connecter de l'application.
- **Faire davantage confiance à la mémoire rappelée**, parce que le souvenir devenu obsolète le signale lui-même.
- **Travailler sur du code qui ne peut pas quitter l'entreprise** tout en donnant à l'agent une connaissance complète de ce code.

[Téléchargez Synapse](https://github.com/SeanHogg/Builderforce.ai/releases?q=desktop-v&expanded=true) pour Windows, macOS ou Linux, puis ouvrez un dossier dans VS Code avec l'extension Builderforce.

---

**À lire aussi :** [Lire, Prouver, Construire — la boucle interne](/blog/read-prove-build-the-inner-loop) · [Le centre de commande VS Code de votre main-d'œuvre agentique](/blog/vs-code-command-center-for-your-agentic-workforce) · [Livrer depuis l'éditeur](/blog/ship-from-the-editor-commit-branch-pull-request)
