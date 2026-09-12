Chaque matin, une équipe quitte ce dont elle parle pour pouvoir en parler.

Le tableau est sur un écran. Le point d'équipe (stand-up) est sur un autre — une salle de réunion, une table ronde, une mosaïque de visages — et quelqu'un partage son écran pour que tout le monde puisse voir le tableau que tous viennent de quitter. Quinze minutes plus tard, chacun retourne là où il était déjà.

Ce n'est pas un problème de visioconférence. C'est un problème de forme : la cérémonie dont le sujet tout entier est le travail qui se trouve devant vous était la seule cérémonie qui n'avait pas sa place sur ce travail.

## La salle

Il existe désormais une cinquième façon de lire un tableau, aux côtés de la conversation, du graphe, de l'espace 3D et de l'app : **la salle**.

```bf-figure
{
  "kind": "screen",
  "frame": "Un tableau, lu comme une salle",
  "ratio": 1.62,
  "regions": [
    { "label": "Le cercle", "note": "Tous les participants de la session, debout autour d'une table. Votre propre silhouette est dessinée avec celles des autres.", "x": 4, "y": 8, "w": 66, "h": 62, "hue": "make" },
    { "label": "Le mur", "note": "Les objets les plus récents de la session, avec la vraie image produite par chacun", "x": 12, "y": 12, "w": 50, "h": 22, "hue": "idea" },
    { "label": "Qui est là", "note": "Allumé pour les personnes dans la salle, atténué pour celles qui sont sur le tableau", "x": 73, "y": 8, "w": 23, "h": 74, "hue": "accent" },
    { "label": "Sélecteur de surface", "x": 4, "y": 88, "w": 30, "h": 8, "hue": "accent" },
    { "label": "N sur M présents", "x": 38, "y": 88, "w": 32, "h": 8, "hue": "accent" }
  ],
  "caption": "Rattachée au tableau, comme les surfaces app et Analyses : le sujet de la salle est toute la session, il n'y a donc aucune carte depuis laquelle y entrer, et appuyer sur le bouton sans rien sélectionner a un sens."
}
```

Appuyez sur Salle et le tableau devient un lieu. Votre équipe se tient en cercle autour d'une table. Derrière elle, au mur, se trouvent les objets de la session — pas leurs icônes, mais l'aperçu réellement rendu que chacun a produit. Cliquez sur l'un d'eux et il sélectionne la carte qu'il représente.

## Chacun a sa chaise

La décision de conception la plus importante concernait l'absence.

Une salle où les gens n'apparaissent qu'une fois qu'ils bougent est une salle où l'on ne distingue pas « personne n'est venu » de « personne n'a encore parlé ». La salle installe donc **toute la liste des participants** et indique qui est réellement là : une silhouette éclairée avec une plaque nominative lumineuse pour quelqu'un présent dans la salle à cet instant, une silhouette atténuée pour un collègue qui est sur le tableau plutôt que dedans.

```bf-figure
{
  "kind": "compare",
  "title": "Deux réponses à « qui est là ? »",
  "columns": [
    {
      "title": "Une salle avec ses propres membres",
      "hue": "bad",
      "items": [
        "La salle tient son propre registre de qui l'a rejointe",
        "Un ordinateur refermé laisse ce registre en l'état",
        "La liste et la salle peuvent diverger",
        "La présence devient quelque chose à réconcilier"
      ]
    },
    {
      "title": "Un seul registre de présence, deux lectures",
      "hue": "good",
      "items": [
        "La salle ne possède aucun membre en propre",
        "Un pointeur et une silhouette transitent dans la même trame de relais",
        "Partir retire immédiatement votre silhouette",
        "Le tableau et la salle ne peuvent pas diverger"
      ]
    }
  ],
  "caption": "Un curseur sur le tableau et une silhouette dans la salle posent la même question — où est cette personne en ce moment ? — depuis deux surfaces. Ils partagent donc un seul canal au lieu d'en faire pousser chacun un."
}
```

C'est ce choix qui explique pourquoi la salle n'a nécessité ni nouvelle table en base de données, ni nouvelle adhésion, ni nouvel enregistrement. Elle lit la liste de participants dont la session dispose déjà et la présence en direct que le tableau transporte déjà.

Une subtilité mérite d'être nommée, car elle est à l'opposé du comportement d'un curseur. Un pointeur immobile est un pointeur périmé : le tableau l'oublie donc au bout d'une demi-minute. Or rester immobile, c'est précisément ce *qu'est* un stand-up — la présence dans la salle est donc réaffirmée par un battement discret, et dès que vous partez, votre silhouette part avec vous.

## Des images aux murs

Le même changement a donné aux espaces 3D quelque chose qu'ils n'avaient jamais eu : une surface sur laquelle on peut poser quelque chose.

Un accessoire pouvait indiquer sa couleur et rien d'autre, c'est pourquoi rien ne pouvait jamais y être *posé*. Désormais, tout accessoire à face plane accepte une image — la photo d'un tableau blanc, un diagramme, un rendu — qui s'y affiche à l'échelle réelle, lisible à l'ombre comme au soleil.

```bf-figure
{
  "kind": "flow",
  "title": "Une seule façon de peindre une face, trois endroits où elle apparaît",
  "steps": [
    { "label": "Définir", "note": "Collez l'URL d'une image sur un mur, une plateforme ou une zone d'objectif dans l'espace 3D", "hue": "make" },
    { "label": "Accrocher", "note": "Le mur de la salle utilise la même primitive pour les objets de la session, avec un chargement et des échecs identiques", "hue": "make" },
    { "label": "Se dégrader proprement", "note": "Une image qui ne se charge pas revient à la couleur propre de l'accessoire, plutôt qu'à un carré noir ou une surface vide", "hue": "run", "tag": "les URL saisies se cassent" }
  ],
  "caption": "Une image sur un mur dans un monde et une carte sur un mur dans la salle sont dessinées par un seul composant : elles ne peuvent donc ni avoir un aspect différent, ni se charger différemment, ni échouer différemment."
}
```

Et une salle dans laquelle on ne peut pas entrer est pire qu'une vue à plat : là où WebGL refuse de démarrer, la même session s'ouvre sous la forme d'un cercle de noms lisible au lieu d'afficher un refus.

## Sa place dans la méthode

La salle est la première surface dont le sujet est les **personnes** plutôt que les objets, ce qui lui donne une place singulière sur l'arc — car elle se rend utile de manières différentes selon les étapes, et n'est inutile à aucune.

Elle est proposée dès **Idée**, ce qui rompt délibérément avec la façon dont Analyses est conditionnée. Analyses reste masquée jusqu'à Mesurer, car un tableau de bord sans rien d'épinglé ne peut rien montrer à son lecteur. Une salle avec une seule personne dedans est une salle avec une seule personne dedans : correcte, lisible, et exactement ce à quoi ressemble un atelier dix secondes avant l'arrivée de la deuxième personne. Conditionner une *réunion* à l'étape dans laquelle un tableau déclare se trouver serait une règle mal pensée — deux personnes qui veulent parler d'une idée, c'est l'argument en faveur de la salle, pas contre elle.

Là où elle change le plus de choses :

- **Idée** — l'atelier. Prendre du recul face à un mur et voir comment les choses sont regroupées est un geste spatial que le logiciel avait aplati ; c'est ici qu'il revient.
- **Créer** — le stand-up quotidien, et la seule étape où la salle est la réponse complète. Personne ne veut écrire du code depuis une salle. En revanche, tout le monde veut quinze minutes avec chaque visage visible et le travail du sprint au mur derrière soi.
- **Mesurer** — la rétrospective, la cérémonie la *plus* spatiale qui soit : un mur, une chronologie, et des gens debout à l'endroit où les choses ont dérapé.

Lire → Prouver → Créer dit que les deux actes qui décident si l'acte coûteux vaut la peine sont tous deux gratuits. Un stand-up en fait partie. Il ne coûte rien, il change ce qui est construit, et il n'aurait jamais dû exiger de quitter le tableau.

Appuyez sur **Salle**.
