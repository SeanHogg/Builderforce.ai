# Dites à l’agent ce que chaque exécution doit faire, et versionnez-le avec le code

Chaque équipe a une courte liste de choses sans lesquelles une modification n’est pas terminée. Le README mentionne le nouvel indicateur. DONE.md consigne ce qui a été livré. Le linter est au vert. Personne ne pousse sur main avec un test en échec.

Vous pourriez le dire à l’agent à chaque fois, mais vous l’oublieriez. Votre coéquipier ne saurait même pas qu’il faut le dire. Et une consigne tapée dans une discussion s’achève avec cette discussion : la session suivante repart de zéro.

Cette liste appartient au dépôt, pas à la personne qui se trouve en train de taper. Elle y vit donc désormais.

## Les hooks d’espace de travail

Ajoutez un fichier à votre dépôt, `.builderforce/hooks.json` :

```json
{
  "hooks": [
    { "on": "stop", "prompt": "Update README.md and DONE.md with the work completed in this session." },
    { "on": "stop", "command": "npm run lint" },
    { "on": "preTool", "tool": "git_push", "command": "npm test" },
    { "on": "postTool", "tool": "write_file|edit_file", "command": "npx prettier --check ." }
  ]
}
```

Chaque exécution d’agent dans cet espace de travail le suit désormais, qu’elle démarre dans le panneau BuilderForce ou dans la discussion intégrée de VS Code.

```bf-figure
{
  "kind": "flow",
  "title": "Où chaque hook se déclenche dans une exécution",
  "steps": [
    { "label": "preTool", "note": "Avant un appel d’outil correspondant. Une commande en échec refuse l’appel, et l’agent voit pourquoi.", "hue": "make" },
    { "label": "postTool", "note": "Après un appel réussi. La sortie d’un contrôle en échec est renvoyée à l’agent avec le résultat.", "hue": "make" },
    { "label": "stop", "note": "L’exécution est sur le point de se terminer. Un prompt est transmis une fois. Un contrôle en échec retient l’exécution jusqu’à ce qu’il réussisse.", "hue": "run", "tag": "avant la livraison" },
    { "label": "runEnd", "note": "Après la fin de l’exécution. Une commande pour les notifications, les rapports et le nettoyage.", "hue": "measure" }
  ],
  "caption": "Les hooks stop s’exécutent avant que l’agent ne commite et ne pousse : tout ce qu’ils demandent, comme de la documentation, une ligne de journal des modifications ou une correction de lint, part dans le même commit."
}
```

Un **prompt** est une instruction, en langage courant, que l’agent exécute avec ses propres outils. Une **commande** est un contrôle exécuté à la racine de l’espace de travail, dont la sortie décide de la suite. Par défaut, les hooks stop ne se déclenchent que sur les exécutions qui ont modifié du code : une question sur la base de code n’envoie donc pas l’agent réécrire votre README. Définissez `"when": "always"` si vous en voulez un à chaque exécution.

Les consignes permanentes qui ne sont pas liées à un moment précis vont dans `.builderforce/rules.md`, par exemple « utilise pnpm », « chaque migration reçoit un retour arrière » ou « écris les tests avec Vitest ». Il est lu dans les instructions de chaque exécution, sous les barrières de gouvernance de votre organisation et au-dessus de tout le reste.

```bf-figure
{
  "kind": "screen",
  "frame": "Un dépôt avec des directives d’équipe",
  "ratio": 1.62,
  "regions": [
    { "label": ".builderforce/hooks.json", "note": "Vérifié à la frappe par rapport à son schéma", "x": 4, "y": 8, "w": 44, "h": 40, "hue": "make" },
    { "label": ".builderforce/rules.md", "note": "Consignes permanentes pour chaque tâche", "x": 4, "y": 52, "w": 44, "h": 36, "hue": "idea" },
    { "label": "Discussion avec l’agent", "note": "Avant de terminer, cet espace de travail vous demande de : mettre à jour README.md et DONE.md…", "x": 52, "y": 8, "w": 44, "h": 80, "hue": "run" }
  ],
  "caption": "Les deux fichiers sont du texte brut dans votre dépôt : relus dans les pull requests, versionnés avec le code et identiques pour toute personne qui le clone."
}
```

## Partagés, et toujours sûrs

Les fichiers vivent dans `.builderforce/` : ils sont donc versionnés. Cela signifie aussi qu’un fichier de hooks arrive avec chaque clone, et qu’une commande qu’il contient s’exécute sur votre machine. Les commandes ne s’exécutent donc pas tant que vous ne les avez pas approuvées, une fois par machine. VS Code vous montre la liste exacte. Si quelqu’un modifie une commande ou en ajoute une, on vous le demande de nouveau. Modifier un prompt ou les règles ne demande aucune approbation, car ce sont des textes que l’agent lit, comme tout autre fichier du dépôt. Dans un espace de travail auquel VS Code ne fait pas confiance, rien ne s’exécute.

## Sa place dans la méthode

Les hooks relèvent de **Construire**, le troisième acte et le plus coûteux. [Lire et Prouver](/blog/read-prove-build-the-inner-loop) ne coûtent rien parce qu’aucun code n’a encore changé. Dès que le code change, la définition de « terminé » d’une équipe est ce qui empêche une exécution de laisser un désordre à la personne suivante. Dans une session d’éditeur local, l’agent est le seul relecteur que la modification aura avant d’être livrée : les standards de l’équipe doivent donc faire partie de l’exécution elle-même, et non d’un rappel qui dépend de la mémoire de quelqu’un.

```bf-figure
{
  "kind": "compare",
  "title": "Terminer une modification",
  "columns": [
    { "title": "Sans hooks", "hue": "muted", "items": ["L’agent livre le code", "Quelqu’un remarque que le README est périmé", "Quelqu’un d’autre remarque que le lint est au rouge", "Un commit de suivi corrige les deux", "L’exécution du coéquipier suivant recommence"] },
    { "title": "Avec les hooks d’espace de travail", "hue": "make", "items": ["L’agent modifie le code", "Il met à jour la documentation qu’on lui a demandée", "Le lint doit réussir avant qu’il puisse terminer", "Un seul commit livre le tout", "Il en va de même pour toute l’équipe"] }
  ],
  "caption": "La définition de « terminé » d’une équipe passe d’une habitude à une partie de l’exécution."
}
```

## Ce que vous pouvez en faire dès aujourd’hui

- **Garder la documentation à jour sans le demander** : un prompt stop fait de « mettre à jour README et DONE » une partie de chaque modification.
- **Faire d’un contrôle une exigence** : une commande stop retient l’exécution jusqu’à ce que votre linter ou votre vérification de types réussisse, dans la limite d’un nombre borné de tentatives.
- **Conditionner les actions risquées** : une commande preTool peut refuser `git_push` tant que `npm test` ne réussit pas.
- **Corriger au fil de l’eau** : un contrôle postTool en échec renvoie directement la plainte du formateur à l’agent.
- **Tout partager via git** : versionnez `.builderforce/` et l’agent de chaque coéquipier suit les mêmes directives.

Exécutez **BuilderForce: Edit Workspace Hooks** dans VS Code pour créer un fichier de départ.

---

**À lire aussi :** [Points d’approbation et supervision humaine](/blog/approval-gates-and-human-oversight) · [BuilderForce contre Claude Code](/blog/builderforce-vs-claude-code) · [Orchestration multi-agents](/blog/multi-agent-orchestration)
