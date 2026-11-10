Commencez une conversation avec un agent dans VS Code, reprenez-la en cours de fil dans le navigateur, et l'agent qui vous y répond dispose des mêmes outils, suit les mêmes règles et garde-fous, et son travail passe par la même vérification. Une correction obtenue à un endroit est une correction partout.

Cela ne fonctionne que si ce qui vous répond est la même chose partout. Pendant longtemps, ce n'était pas le cas : l'éditeur, l'application web, Rovr et les canaux on-prem avaient chacun leur propre boucle d'exécution, leur propre câblage d'outils et, les mauvais jours, quatre réponses différentes à la même question.

Désormais, **la surface change, mais pas l'agent.** Un seul cœur d'exécution fait tourner chaque conversation, sur chaque hôte.

## Une boucle, pas quatre

Il n'y a plus qu'une seule boucle d'agent. Les anciennes boucles d'exécution propres à chaque surface ont disparu — supprimées, pas dépréciées —, si bien qu'aucun second moteur ne se cache derrière un flag en attendant de diverger. Cette boucle est le seul chemin qu'un tour puisse emprunter, qu'il démarre dans le panneau de chat de l'éditeur, sur le canvas web, dans Rovr au sein du navigateur ou dans un canal comme Slack.

```bf-figure
{
  "kind": "flow",
  "title": "Une seule boucle derrière chaque surface",
  "steps": [
    { "label": "Votre conversation", "note": "VS Code, web, Rovr ou un canal : la surface est une vue, pas un moteur.", "hue": "make" },
    { "label": "Le noyau unique", "note": "Une seule boucle d'exécution et une seule politique d'outils exécutent chaque tour.", "hue": "run" },
    { "label": "Les mêmes contrôles", "note": "Les mêmes outils, les mêmes garde-fous, la même vérification, quelle que soit la surface utilisée.", "hue": "measure" }
  ],
  "caption": "La surface affiche la conversation ; c'est le noyau qui la porte."
}
```

## Pourquoi c'est important

- **Une conversation est portable.** Commencez sur le bureau, poursuivez dans le navigateur : l'état, la mémoire et l'accès aux outils de l'agent vous suivent, parce qu'ils n'ont jamais été liés à une surface.
- **Une correction est une correction.** Renforcez la politique d'outils une fois, et chaque hôte en hérite. La catégorie de bugs « ça marche dans l'éditeur mais pas sur le web » n'existe plus.
- **Une seule chose à vérifier.** Un unique oracle de conformité rejoue le scénario de référence contre le moteur unique ; « l'agent est-il correct ? » a donc une réponse, pas quatre.

## Sa place dans la méthode

C'est l'étape **Make** rendue digne de confiance : l'agent qui construit est le même partout où vous le rencontrez. Une fiabilité que l'on peut emporter d'une surface à l'autre, c'est ce qui permet au reste de l'arc — Run, Measure — de s'y appuyer.

## Ce que vous pouvez en faire dès aujourd'hui

Ouvrez la même conversation sur deux surfaces et constatez qu'elles concordent. Déplacez une conversation de l'éditeur vers le navigateur en cours de fil. Le noyau est la constante ; la surface, c'est là où vous êtes.
