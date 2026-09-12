Il y a une semaine, [voir ce que l'agent a modifié](/blog/see-what-the-agent-changed-before-you-commit) comblait la moitié d'un manque. L'autre moitié restait ouverte à dessein, et l'article le disait : pas de verbe commit, pas de verbe push, car ce qu'un agent local a le droit de faire à votre dépôt distant relève d'une décision de gouvernance — et livrer les verbes avant la décision revenait à vous confier un agent capable de pousser sur une branche protégée de sa propre initiative.

La décision est prise. Voici ce qu'elle est devenue.

## Ce que c'était avant

Mieux vaut être précis, car l'échec n'était pas « il manquait une fonctionnalité ». C'était pire : on avait *dit* à l'agent qu'il pouvait livrer, et il en était incapable.

Le persona de l'éditeur se terminait par une phrase qui disait à peu près *utilisez `run_command` pour git — pour commiter, pousser et ouvrir une PR quand l'utilisateur veut livrer.* Un conseil sans aucun outil derrière. Alors, quand quelqu'un a demandé à un agent de commiter un correctif CSS d'une ligne puis de le pousser, voici ce qui s'est passé :

```bf-figure
{
  "kind": "flow",
  "title": "Une seule demande, et chacune de ses étapes qui déraille",
  "steps": [
    { "label": "« committe la modification et pousse-la sur main »", "note": "La modification est déjà faite, et elle est correcte", "hue": "idea" },
    { "label": "git_status échoue", "note": "Le dossier ouvert contient plusieurs checkouts : il n'y a donc aucun dépôt à sa racine", "hue": "bad", "tag": "1" },
    { "label": "git_sync_latest ne peut pas être ciblé", "note": "Il n'acceptait aucun argument `repo` — contrairement à git_status, qui en accepte un", "hue": "bad", "tag": "2" },
    { "label": "Fouille le catalogue d'outils", "note": "Il n'y a aucun verbe commit à trouver ; `run_command` avait été retiré du tour", "hue": "bad", "tag": "3" },
    { "label": "git add -A && git commit && git push", "note": "Tous les fichiers d'un arbre de travail partagé, sans relecture, directement sur main", "hue": "bad", "tag": "4" }
  ],
  "caption": "Quatre défauts indépendants, une seule demande. Le dernier est le plus dangereux, et c'est précisément celui que les trois premiers ont rendu inévitable."
}
```

C'est sur l'étape quatre qu'il faut s'arrêter. L'arbre de travail comptait trois fichiers modifiés. L'agent n'en avait touché qu'un. `git add -A` ne fait pas la différence, pas plus qu'un agent à qui l'on n'a jamais demandé de la préciser.

## La forme de la réponse

Trois outils, et le chemin sûr est celui qui est à portée de main.

```bf-figure
{
  "kind": "flow",
  "title": "Le chemin par défaut",
  "steps": [
    { "label": "git_commit", "note": "Nomme les chemins exacts qu'il a modifiés et la branche de ticket où les placer — la branche est créée pour vous", "hue": "make" },
    { "label": "git_push", "note": "Pousse cette branche, en définissant son upstream dès la première fois", "hue": "run" },
    { "label": "open_pull_request", "note": "Ouvre la PR vers la branche de base et peut demander des relecteurs nommément", "hue": "prove" },
    { "label": "Un humain lit le diff", "note": "C'était tout l'enjeu", "hue": "measure" }
  ],
  "caption": "Rien de nouveau ici en tant que workflow. Ce qui change, c'est que c'est désormais le chemin de moindre résistance pour l'agent, et non une option que vous espériez le voir choisir."
}
```

**`git_commit` exige que vous listiez les chemins.** Pas par formalité. Votre arbre de travail est partagé avec vous — l'humain assis devant, en pleine réflexion, avec deux autres fichiers ouverts et à moitié modifiés. `git add -A` embarque ceux-là dans le commit de l'agent et dans sa pull request, et voilà votre travail sans rapport dans la revue de quelqu'un d'autre. Un agent incapable de dire quels fichiers il a modifiés n'a rien à faire à commiter ; l'outil ne le laisse donc pas se dérober.

**Commiter sur la branche de base est refusé.** Passez `branch` et il bascule sur cette branche de ticket, en la créant si elle n'existe pas. Omettez-le alors que vous êtes sur `main`, et vous obtenez une erreur qui indique la marche à suivre plutôt qu'un fatal de git.

**`open_pull_request`** pousse d'abord la branche si elle n'a pas d'upstream, puis ouvre la PR via votre propre connexion `gh` — aucun jeton ne transite par l'agent, puisque la machine en possède déjà un. Si `gh` n'est pas installé, il indique que la branche est commitée et poussée et vous donne son nom : toute la différence entre un outil qui a échoué et un travail perdu.

## Pousser sur main est un acte déclaré

Vous pouvez toujours le faire. Simplement, cela ne peut plus arriver par accident, ni à l'initiative d'un agent.

```bf-figure
{
  "kind": "compare",
  "title": "« Pousse ça sur main »",
  "columns": [
    { "title": "Avant", "hue": "bad", "items": ["Aucun outil — on retombe sur un shell brut", "`git add -A` indexe tout ce qui traîne", "Directement sur la branche de base", "L'invite d'approbation affiche : run: git add -A && git com…", "Rien ne proposait de pull request, puisque rien ne le pouvait"] },
    { "title": "Désormais", "hue": "good", "items": ["L'agent propose d'abord une pull request, et explique pourquoi", "Seuls les chemins qu'il nomme sont indexés", "Refusé sauf si `allowBaseBranch` est défini", "L'invite affiche : push vers la BRANCHE DE BASE (main) — contourne la revue de pull request", "Vous approuvez cet acte précis, ou vous ne l'approuvez pas"] }
  ],
  "caption": "La ligne du milieu, c'est la décision de gouvernance. La quatrième est ce qui en fait une vraie décision — une approbation que vous ne pouvez pas lire n'est pas une approbation."
}
```

Chacun de ces outils modifie l'état : ils passent donc par le même point d'approbation que `write_file` et `delete_file`. Ce point existait déjà ; ce qui lui manquait, c'était quelque chose qui vaille la peine d'être lu. `git_push` dans une boîte de confirmation ne vous dit rien de la seule chose que vous devez peser. *Push vers la BRANCHE DE BASE (main) — contourne la revue de pull request* vous dit tout.

Ils sont aussi conditionnés à une nouvelle capacité `git.write` plutôt qu'à `shell`. Cela ressemble à de la comptabilité, et ce n'en est pas : les surfaces cloud ont elles aussi des shells, et elles publient déjà par un mécanisme complètement différent — là-bas, une écriture **est** un commit, et l'exécution ouvre sa pull request quand elle se termine. Leur offrir une seconde voie, non implémentée, vers le même acte ferait apparaître des outils pour lesquels leur runtime n'a aucun gestionnaire, ce qui échoue en pleine exécution. Une capacité, une surface, une seule façon de publier par couloir.

## Le correctif discret en dessous

La raison pour laquelle l'agent est allé chercher `run_command` mérite d'être nommée, car il s'agit d'une classe de bugs plutôt que d'un incident isolé.

Le catalogue compte environ 440 outils. Environ 64 sont proposés à chaque tour, choisis par pertinence lexicale par rapport à votre demande. `run_command` ne partage aucune racine avec « committe la modification et pousse-la sur main » — si bien qu'au tour précis où il était nécessaire, il avait été écarté. L'agent a lu ses propres instructions, est allé chercher l'outil qu'elles nommaient, et ne l'a pas trouvé.

Les neuf outils git sont désormais épinglés sans condition, aux côtés des outils de fichiers. La pertinence est une manière raisonnable de choisir entre des domaines. Ce n'en est pas une pour décider si l'agent peut toucher à l'espace de travail dans lequel il se trouve.

## Sa place dans la méthode

C'est l'étape **Créer** de [Lire, Prouver, Créer](/blog/read-prove-build-the-inner-loop) qui atteint enfin son propre terme, et le passage de relais **Créer → Piloter** sur l'arc [Idée → Créer → Piloter → Mesurer](/blog/idea-make-run-measure-menu-as-methodology).

La version précédente rendait ce passage *visible* : du code existait sur le disque, rien n'avait été commité, et vous pouviez désormais le voir et lire chaque diff. Mais visible ne veut pas dire franchissable. Vous pouviez inspecter le travail, puis deviez quitter l'outil pour le faire avancer — autrement dit, l'arc présentait une couture exactement là où une méthodologie est censée être sans couture, et chaque modification locale devenait discrètement une étape manuelle dont quelqu'un devait se souvenir.

Ce qui la referme, ce n'est pas « l'agent peut maintenant pousser ». C'est que la sortie de Créer aboutit par défaut dans **Prouver** — une pull request, un diff, un relecteur — au lieu d'aboutir dans Piloter en sautant la revue. Commiter sur une branche de ticket et ouvrir une PR est plus lent que pousser sur `main` d'exactement une étape, et cette étape est celle où un humain regarde la modification. Faire du chemin relu le chemin par défaut : tout l'argument est là.

Pousser sur la branche de base reste possible, parce que c'est parfois réellement la bonne décision, et qu'une méthodologie qui prétend le contraire finit contournée. Il vous en coûte simplement une phrase pour le dire, et une invite qui vous explique ce que vous approuvez.

## Ce que vous pouvez en faire dès aujourd'hui

- **Demandez une modification, puis demandez de la livrer**, et récupérez une branche de ticket et l'URL d'une pull request — pas une commande shell à auditer.
- **Ayez la certitude que seule votre modification s'y trouve**, puisque l'agent a dû nommer les fichiers.
- **Dites « pousse sur main » et l'on vous propose une revue à la place** — tout en obtenant votre push si vous confirmez que c'était bien votre intention.
- **Demandez des relecteurs nommément** sur la pull request que l'agent ouvre.
- **Travaillez dans un dossier qui contient plusieurs checkouts**, ce que tous les outils git gèrent désormais : passez `repo` et chacun se place dans le bon. `git_sync_latest`, `git_undo` et `git_redo` en étaient incapables jusqu'ici et échouaient à la racine de l'espace de travail sans rien qui en indique la raison.

---

**À lire aussi :** [Voir ce que l'agent a modifié — avant de le commiter](/blog/see-what-the-agent-changed-before-you-commit) · [Points d'approbation et supervision humaine](/blog/approval-gates-and-human-oversight) · [VS Code, centre de commande de votre main-d'œuvre agentique](/blog/vs-code-command-center-for-your-agentic-workforce)

Installez l'[extension BuilderForce pour VS Code](https://marketplace.visualstudio.com/items?itemName=BuilderForce.builderforce-ai), demandez à un agent de corriger quelque chose, puis demandez-lui de le livrer.
