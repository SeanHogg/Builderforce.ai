Vous demandez un correctif. L'agent travaille, commente, termine et déclare : *la modification du fichier a été effectuée localement — vous devrez commiter et pousser manuellement.*

Et ensuite ?

La modification est réelle. Elle est sur votre disque, en ce moment même. Et jusqu'à cette version, rien dans BuilderForce ne le signalait. Le chat affichait un tour terminé. Le rail des tickets, au-dessus, affichait une tâche en cours. Chaque section de la barre latérale — Sessions, Discussions, Projet et tâches, Boîte de réception — continuait comme si rien n'avait touché au système de fichiers. La seule trace de la modification était une phrase dans une transcription à laquelle il fallait faire confiance, et le seul chemin vers le code consistait à penser de vous-même à ouvrir la vue Contrôle de code source de VS Code, puis à la rapprocher de mémoire de la conversation.

Étrange, pour un outil dont toute la promesse est que les agents accomplissent un travail que vous pouvez inspecter.

## Ce qu'il y a désormais

Deux surfaces, qui lisent une seule et même réponse.

```bf-figure
{
  "kind": "screen",
  "frame": "L'éditeur après un tour d'agent qui a touché au code",
  "ratio": 1.62,
  "regions": [
    { "label": "Modifications", "note": "Une nouvelle section de la barre latérale. Badge de compteur, une ligne par fichier, un clic ouvre le diff.", "x": 3, "y": 22, "w": 32, "h": 30, "hue": "make" },
    { "label": "Sessions · Projet · Boîte de réception", "note": "Inchangé", "x": 3, "y": 54, "w": 32, "h": 34, "hue": "muted" },
    { "label": "Barre d'activité", "note": "Le badge de la section remonte jusqu'ici — visible même panneau fermé", "x": 0, "y": 8, "w": 3, "h": 84, "hue": "accent" },
    { "label": "Barre des modifications en attente", "note": "3 modifications non commitées · Examiner", "x": 38, "y": 14, "w": 58, "h": 9, "hue": "make" },
    { "label": "Rail des tickets", "note": "Les tickets sur lesquels travaille ce chat", "x": 38, "y": 25, "w": 58, "h": 12, "hue": "idea" },
    { "label": "La conversation", "x": 38, "y": 39, "w": 58, "h": 49, "hue": "idea" }
  ],
  "caption": "La barre se place au-dessus du rail des tickets, car c'est là que votre regard se pose déjà à la fin d'un tour. La section de la barre latérale sert quand ce n'est pas le cas."
}
```

**Une section Modifications dans la barre latérale BuilderForce.** Une ligne par fichier modifié, avec ce qui lui est arrivé et le dépôt dans lequel il se trouve. Cliquez sur une ligne et le visualiseur de diff de l'éditeur s'ouvre dessus — pas un rendu de diff, le vrai, avec toute sa navigation et la possibilité de modifier le côté droit. La section porte un badge numérique, et VS Code fait remonter les badges des vues jusqu'à l'icône de la barre d'activité : le travail en attente reste visible même panneau replié.

**Une barre des modifications en attente dans le chat**, juste au-dessus du rail des tickets. Elle indique le nombre de modifications, se déplie pour afficher la liste des fichiers et ouvre les mêmes diffs via la même commande. Quand l'arbre est propre, elle n'affiche absolument rien — ni état vide, ni espace réservé. Un signal toujours présent à l'écran n'est pas un signal.

Toutes deux sont alimentées par la même lecture, et c'est plus important qu'il n'y paraît.

## Compter, c'est la partie difficile

« Combien de fichiers sont en attente ? » ressemble à une question dont la réponse est évidente, et elle compte au moins quatre mauvaises réponses.

```bf-figure
{
  "kind": "compare",
  "title": "Ce qu'un comptage naïf fait de travers",
  "columns": [
    { "title": "L'implémentation évidente", "hue": "bad", "items": ["Indexé + non indexé, additionnés", "Un fichier indexé puis modifié compte deux fois", "Un renommage signale le fichier que vous n'avez plus", "Un conflit non fusionné ressemble à une modification indexée", "Les fichiers non suivis sont invisibles, ou bien sont tout"] },
    { "title": "Ce que le nombre doit signifier", "hue": "make", "items": ["Une ligne par FICHIER, quoi que git retienne contre lui", "Indexé puis modifié : une seule modification en attente, marquée indexée", "Un renommage, c'est sa destination — le fichier qui existe", "Un conflit s'affiche comme conflit, car le remède diffère", "Un fichier non suivi est listé, et jamais qualifié d'indexé"] }
  ],
  "caption": "Chacun de ces cas correspond à un test de la suite. Ils existent parce qu'un compteur impossible à rapprocher de la vue Contrôle de code source juste à côté est pire qu'aucun compteur."
}
```

La correspondance vit dans un module unique, indépendant de l'hôte, avec dix-huit tests portant exactement sur ces cas — dont `AD`, où vous avez indexé un ajout puis supprimé le fichier, et où la modification en attente est la suppression plutôt que l'ajout. Tout ce qui se trouve au-dessus lit ce module unique : la barre latérale, la barre du chat et les informations sur le dépôt communiquées à l'agent lui-même au début d'un tour. Ces dernières étaient discrètement fausses dans l'ancien code — elles additionnaient les listes des fichiers indexés et non indexés — si bien que l'on pouvait annoncer au modèle « 2 fichiers non commités » alors qu'une interface en affichait trois. Il n'y a désormais qu'un seul nombre.

## Rester fiable entre deux événements

Les outils de fichiers d'un agent écrivent directement sur le disque. Ils ne passent pas par l'API de documents de l'éditeur, donc rien ne se déclenche dans VS Code quand ils aboutissent. Une surface qui attend sagement une notification continuera de vous dire que rien n'est en attente, alors que trois fichiers viennent de changer sous ses yeux.

```bf-figure
{
  "kind": "flow",
  "title": "Tout ce qui peut modifier l'arbre de travail, et ce qui nous en informe",
  "steps": [
    { "label": "Vous modifiez et enregistrez", "note": "L'événement d'enregistrement de l'éditeur lui-même", "hue": "idea" },
    { "label": "Vous indexez, commitez ou changez de branche", "note": "L'événement d'état du dépôt de l'extension Git", "hue": "run" },
    { "label": "Un agent écrit un fichier", "note": "Rien ne se déclenche — c'est donc l'outil de modification lui-même qui EST le signal, émis dès qu'il réussit", "hue": "make", "tag": "le manque" },
    { "label": "Un seul abonnement partagé", "note": "Quel que soit le nombre de panneaux de chat et de barres latérales qui observent, un seul écouteur et une seule lecture en cache derrière eux tous", "hue": "measure" }
  ],
  "caption": "La troisième étape est celle qui a rendu cette fonctionnalité nécessaire, et celle qu'une conception fondée sur les notifications ne voit pas."
}
```

## Sa place dans la méthode

Nous sommes ici dans **Prouver**, et il vaut la peine d'expliquer précisément pourquoi.

[Lire, Prouver, Créer](/blog/read-prove-build-the-inner-loop) constitue la boucle interne, et Prouver est l'acte peu coûteux qui détermine si Créer était juste. Un agent qui modifie votre code avance une affirmation : *cette modification fait ce que vous avez demandé*. Une transcription qui l'affirme n'est pas une preuve. Le diff est la preuve — et si ce diff se trouve à trois clics, dans un autre outil, la plupart des gens acceptent en pratique l'affirmation au lieu de la vérifier. C'est précisément ainsi qu'un workflow agentique cesse d'être vérifiable et devient quelque chose à quoi l'on fait entièrement confiance, ou que l'on abandonne.

Placer la preuve à un clic de l'affirmation n'est pas une commodité. C'est ce qui garde la boucle fermée.

Cela se situe aussi à une jonction précise de l'arc [Idée → Créer → Piloter → Mesurer](/blog/idea-make-run-measure-menu-as-methodology) : la sortie de **Créer**. Le code existe ; rien n'a encore été commité, exécuté ni mesuré. Ce passage était le seul endroit où la surface de l'éditeur local n'avait aucune représentation — le tableau suit un ticket, le couloir cloud commite chaque écriture et ouvre une pull request à la fin de l'exécution, et, en local, le travail devenait tout simplement invisible dès l'instant où il cessait d'être une conversation pour devenir des fichiers. Il est désormais visible.

## Ce que vous pouvez en faire dès aujourd'hui

- **Savoir, sans avoir à demander, qu'un tour a modifié du code** — le compteur figure sur le chat et sur l'icône de la barre d'activité, et il apparaît dès que l'outil réussit, et non au prochain rafraîchissement fortuit.
- **Lire chaque modification sous forme de vrai diff**, dans le visualiseur de l'éditeur, à un clic de la conversation qui l'a produite.
- **Voir ce qui est déjà indexé**, pour qu'un commit ne réserve aucune surprise.
- **Confier le tout à Brain une fois satisfait** — l'action de titre de la section Modifications ouvre un chat préparé pour relire le diff, commiter sur une branche, pousser et ouvrir une pull request, en vous faisant d'abord confirmer le nom de la branche et le titre.

Une chose que cette version n'a délibérément **pas** faite à l'époque : donner à l'agent ses propres verbes commit ou push. Ce qu'un agent local a le droit de faire à votre arbre de travail et à votre dépôt distant relève d'une décision de gouvernance — une branche ou `main`, un point d'approbation ou non avant un push, et la question de savoir si « ouvrir une PR et demander une revue » doit remplacer « pousser » comme conclusion par défaut. Livrer les verbes avant la décision, c'eût été livrer un agent capable de pousser sur une branche protégée de sa propre initiative. Le chemin de revue est passé en premier, à dessein.

**Depuis, cette décision a été prise et les verbes ont été livrés** : `git_commit` (sur une branche de ticket, en nommant les fichiers exacts qu'il a modifiés), `git_push` (qui refuse la branche de base à moins que vous n'approuviez cet acte précis) et `open_pull_request`. Consultez [Livrer depuis l'éditeur](/blog/ship-from-the-editor-commit-branch-pull-request) pour découvrir comment la question de gouvernance a été tranchée.

---

**À lire aussi :** [VS Code, centre de commande de votre main-d'œuvre agentique](/blog/vs-code-command-center-for-your-agentic-workforce) · [Lire, Prouver, Créer — la boucle interne](/blog/read-prove-build-the-inner-loop) · [Points d'approbation et supervision humaine](/blog/approval-gates-and-human-oversight)

Installez l'[extension BuilderForce pour VS Code](https://marketplace.visualstudio.com/items?itemName=BuilderForce.builderforce-ai), demandez une modification à un agent, et regardez le compteur apparaître.
