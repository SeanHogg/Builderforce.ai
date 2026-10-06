Mesurer s’ouvrait sur un tableau où rien n’était en ligne.

Vous pouviez cliquer dessus à tout moment. Le canevas changeait d’onglet, proposait Analyses et attendait les chiffres d’une app qui n’avait jamais été déployée. Portée faisait pareil : un endroit pour des posts de lancement, sans aucune adresse où envoyer qui que ce soit. Les phases en haut du canevas (Idée, Créer, Piloter, Mesurer, Portée) filtraient les onglets affichés, et rien de plus. Elles ne regardaient jamais ce qu’il y avait sur le tableau. La phase était en plus un seul réglage par navigateur : passer un canevas en Mesurer y faisait passer tous les autres.

Un sélecteur de phase qui ne sait pas si une phase est possible n’est qu’un menu. La méthode qui le sous-tend en dit plus : on ne mesure pas ce qui ne tourne pas, et on ne construit pas avant d’avoir écrit l’idée. Le canevas le sait désormais aussi.

## Être prêt, lu directement sur le tableau

Chaque phase lit maintenant le tableau sur lequel elle se trouve. Pas de réglage, pas de liste à cocher. Elle regarde les objets que le travail a déjà laissés derrière lui :

- **une carte idée** signifie qu’Idée est terminée ;
- **une app**, c’est-à-dire les cartes de code qui tournent ensemble, signifie que Créer est terminé ;
- **un déploiement avec une adresse** signifie que Piloter est terminé ;
- **une métrique** signifie que Mesurer est terminé.

Dans la barre des phases, chacune affiche l’un de trois états : une coche quand son propre résultat existe, un cadenas quand elle a d’abord besoin d’une phase précédente, ou rien quand vous pouvez y travailler. Chaque canevas garde sa propre phase. Si vous n’en avez choisi aucune, le canevas s’ouvre sur la **première phase que vous n’avez pas encore terminée**. Un tableau déjà en ligne ne vous renvoie donc pas à Idée.

```bf-figure
{
  "kind": "flow",
  "title": "L’arc, lu sur un tableau avec une idée et une app, mais rien de déployé",
  "steps": [
    { "label": "Idée", "note": "Une carte idée est sur le tableau.", "hue": "idea", "tag": "✓ terminé" },
    { "label": "Créer", "note": "Les cartes de code tournent comme une app.", "hue": "make", "tag": "✓ terminé" },
    { "label": "Piloter", "note": "Pas encore de déploiement avec une adresse. C’est ici que le canevas s’ouvre.", "hue": "run", "tag": "maintenant" },
    { "label": "Mesurer", "note": "Lit ce que fait une app en ligne, donc a d’abord besoin de Piloter.", "hue": "measure", "tag": "nécessite Piloter" },
    { "label": "Portée", "note": "Envoie des gens vers quelque chose d’en ligne, et recommande une métrique avant de dépenser.", "hue": "reach", "tag": "nécessite Piloter" }
  ],
  "caption": "Rien de nouveau n’est enregistré. L’état se déduit des cartes déjà présentes sur le tableau : dès qu’un déploiement arrive, le cadenas de Piloter devient une coche, sans recharger."
}
```

## Un cadenas qui ne verrouille jamais

Le cadenas est une indication, pas une barrière. Cliquez sur Mesurer sur ce tableau et Mesurer s’ouvre, avec toutes les vues qui fonctionnent. Ce qui change, c’est ce qu’il vous dit. En haut du canevas, une carte de parcours nomme ce qui manque et le chemin le plus court pour l’obtenir.

```bf-figure
{
  "kind": "screen",
  "frame": "Mesurer, sur un tableau où rien n’est en ligne",
  "ratio": 1.62,
  "regions": [
    { "label": "Barre des phases", "note": "Idée ✓ · Créer ✓ · Piloter · Mesurer (cadenas) · Portée (cadenas)", "x": 4, "y": 4, "w": 56, "h": 9, "hue": "accent" },
    { "label": "Mesurer · à 1 étape", "note": "Mettez l’app en ligne avant de la mesurer. Aller à Piloter · Publier l’app", "x": 4, "y": 16, "w": 56, "h": 15, "hue": "measure" },
    { "label": "Le tableau", "note": "Cartes KPI et expérience entourées, tout le reste estompé", "x": 4, "y": 35, "w": 62, "h": 50, "hue": "measure" },
    { "label": "L’emplacement de la première métrique", "note": "Pas encore · nécessite Piloter", "x": 70, "y": 35, "w": 26, "h": 26, "hue": "measure", "style": "ghost" },
    { "label": "Barre de commandes · MESURER teintée", "x": 4, "y": 89, "w": 92, "h": 8, "hue": "accent" }
  ],
  "caption": "La carte de parcours remplace un écran vide. « Aller à Piloter » change de phase, et « Publier l’app » ouvre le panneau de publication de l’app : vous choisissez l’adresse, vous appuyez sur Publier, et le déploiement arrive tout seul sur le tableau. Repliez-la en pastille si vous avez besoin de place : elle revient à la prochaine ouverture du canevas."
}
```

La carte en pointillés à droite est un repère, pas une carte. Elle marque l’endroit où ira le premier objet de la phase, et elle n’est jamais enregistrée, synchronisée ni ajoutée à l’historique d’annulation. Quand la phase est prête, elle propose d’ajouter cet objet ou de laisser Brain le créer. Quand elle ne l’est pas, elle dit ce que la phase attend.

## Le tableau met la phase au premier plan

Le plus grand changement porte sur la lecture du tableau lui-même. Chaque phase a ses types d’objets. Idée a les idées, les entretiens, les expériences, les personas et les risques. Créer a les specs, les pages, les prototypes et le code. Piloter a les déploiements, les versions et les incidents. Mesurer a les KPI, les tableaux de bord, les graphiques et les expériences. Portée a les posts, les campagnes, les audiences et les fiches. Ces cartes reçoivent un contour dans la couleur de la phase. Tout le reste s’estompe.

```bf-figure
{
  "kind": "compare",
  "title": "Le même tableau dans Mesurer, focus de phase désactivé puis activé",
  "columns": [
    { "title": "Focus de phase désactivé", "hue": "muted", "items": ["Chaque carte à pleine intensité", "Le KPI se perd entre une spec, une page d’atterrissage et six cartes de code", "Pour trouver les chiffres, il faut lire chaque titre", "Pratique pour réorganiser tout le tableau"] },
    { "title": "Focus de phase activé", "hue": "measure", "items": ["Cartes KPI, tableau de bord et expérience entourées", "Specs, pages et code estompés, toujours cliquables", "Les liens entre cartes estompées s’estompent aussi", "Une carte sélectionnée reste toujours à pleine intensité", "Pas encore de métrique ? Une carte en pointillés montre où elle ira"] }
  ],
  "caption": "Le focus de phase est activé par défaut et se trouve dans le menu ••• du tableau. Rien ne bouge : le tableau que vous avez organisé reste tel quel."
}
```

Le reste du canevas suit la même phase. La barre de commandes met en avant le groupe de la phase où vous êtes. Les points de départ commencent par trois suggestions pour cette phase, comme « Définir la métrique clé » dans Mesurer ou « Rédiger un post de lancement » dans Portée, avant le catalogue complet. Dans la salle, la station de la phase s’allume et passe en tête de liste. Quand la phase n’est pas prête, une station-panneau se dresse dans la salle et dit ce qui manque : *Nécessite une app en ligne*.

## Deux nouveaux lieux : Exploiter et Lancer

Deux phases n’avaient pas de lieu à elles.

**Exploiter** apparaît à partir de Piloter. Vous y voyez ce que ce canevas fait tourner : chaque déploiement avec son environnement, sa version, son adresse et sa date ; les versions du tableau ; et si l’app est en ligne. Si vous avez construit une app sans la déployer, Exploiter le dit clairement et vous ouvre le panneau de publication de l’app. Dès que le site est en ligne, son déploiement, avec l’adresse, est consigné sur le tableau, et Piloter est terminé.

**Lancer** apparaît à Portée. Prouver l’idée, publier le tableau, le mettre en vente et le faire savoir étaient jusqu’ici quatre portes séparées. Lancer les réunit sur une seule page, dans cet ordre, parce que c’est l’ordre dans lequel elles doivent se faire.

**Analyses**, à partir de Mesurer, s’ouvre maintenant sur *Ce canevas* : les métriques définies sur ce tableau, celles en retard sur leur objectif en premier, avant les chiffres épinglés depuis ailleurs. Quand le tableau n’a encore aucune métrique, il propose de laisser Brain en définir une.

Une chose a bougé dans l’autre sens. **L’app commence désormais à Créer.** Dans Idée, vous testez si quelqu’un veut la chose. Un prototype pour ça, c’est une carte expérience sur le tableau, pas une app à construire avant d’avoir testé l’idée.

## Sa place dans la méthode

La méthode, c’est [Idea to Real](/blog/idea-to-real-the-operating-methodology) : Idée, Créer, Piloter, Mesurer, puis Portée. Chaque phase a maintenant quelque chose que le tableau doit contenir avant que la suivante puisse travailler, et quelque chose qu’elle laisse derrière elle.

```bf-figure
{
  "kind": "flow",
  "title": "Ce que chaque phase laisse sur le tableau, et ce dont la suivante a besoin",
  "steps": [
    { "label": "Idée", "note": "Lire l’idée et la prouver à peu de frais. Laisse une carte idée. Vues : Chat, Tableau, Idées, Salle.", "hue": "idea" },
    { "label": "Créer", "note": "Ne construire que ce que la preuve a mérité. Nécessite une idée, laisse une app. Ajoute App.", "hue": "make" },
    { "label": "Piloter", "note": "La mettre quelque part de réel. Nécessite une app, laisse un déploiement avec une adresse. Ajoute Exploiter.", "hue": "run" },
    { "label": "Mesurer", "note": "Évaluer le chiffre de la preuve. Nécessite quelque chose en ligne, laisse une métrique. Ajoute Analyses.", "hue": "measure", "tag": "la boucle se referme ici" },
    { "label": "Portée", "note": "L’amener aux gens. Nécessite quelque chose en ligne, et prévient quand rien n’est mesuré. Ajoute Lancer.", "hue": "reach" }
  ],
  "caption": "Chaque phase garde toutes les vues de la précédente et ajoute la sienne. Une phase plus avancée ne retire jamais un outil."
}
```

**Idée** est l’endroit où ont lieu [Lire et Prouver](/blog/read-prove-build-the-inner-loop), et les deux sont gratuits. Le canevas y propose Idées et Salle et retient App, parce que construire est l’acte coûteux et que la méthode veut que ce soit une décision.

**Créer**, c’est Build. Il faut une idée sur le tableau ; s’il n’y en a pas, la seule étape de la carte de parcours est « Laisser Brain la noter ».

**Piloter**, c’est le moment où une esquisse devient quelque chose avec une adresse. Exploiter est l’endroit où vous la regardez.

**Mesurer**, c’est là que la boucle se referme. Chaque preuve porte un chiffre qui pourrait arrêter le projet, et ce chiffre est [évalué ici](/blog/grade-the-proof-and-close-the-loop). C’est pour ça que Mesurer a besoin de quelque chose en ligne. Une métrique sur une app que personne ne peut atteindre ne mesure rien.

**Portée** a elle aussi besoin de quelque chose en ligne, et *recommande* en plus une métrique. Elle vous laisse lancer sans, mais vous dit qu’aller vers les gens sans mesurer, c’est dépenser à l’aveugle.

Rien de tout ça ne vous bloque. Chaque phase s’ouvre et chaque vue fonctionne. La différence, c’est que le canevas sait maintenant ce que contient le tableau. Il peut donc vous dire honnêtement ce qui manque et proposer de faire l’étape suivante.

## Ce que vous pouvez en faire dès aujourd’hui

- **Ouvrir n’importe quel canevas et arriver sur la prochaine étape que vous n’avez pas faite**, pas là où le dernier canevas s’était arrêté.
- **Cliquer sur une phase pour laquelle vous n’êtes pas prêt** et obtenir le chemin le plus court, avec un clic pour que Brain fasse la première étape.
- **Lire le tableau à travers la phase** : les cartes qui comptent passent devant et le reste s’estompe, jusqu’à ce que vous désactiviez le focus de phase.
- **Voir ce qui tourne** dans Exploiter : déploiements, versions et état en ligne de l’app, sur le tableau même où vous l’avez construite.
- **Lancer depuis un seul endroit** : le prouver, le publier, le vendre et le faire savoir, dans cet ordre.

Le tableau a toujours été la trace du travail. Maintenant, il vous dit aussi dans quelle phase vous êtes et ce qui vient ensuite.

---

**À lire aussi :** [Idea to Real : la méthode derrière Builderforce](/blog/idea-to-real-the-operating-methodology) · [L’app de votre canevas est désormais un vrai projet](/blog/your-canvas-app-is-a-real-project) · [Évaluer la preuve et refermer la boucle](/blog/grade-the-proof-and-close-the-loop)

[Ouvrez un canevas](/create) et cliquez sur Mesurer avant que quoi que ce soit soit en ligne.
