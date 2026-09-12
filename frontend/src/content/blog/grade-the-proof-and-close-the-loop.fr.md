Demandez à une équipe ce qu'elle a livré le trimestre dernier et vous obtiendrez une liste. Demandez-lui ce qu'elle a appris et vous obtiendrez une histoire, racontée de mémoire, par la personne présente dans la pièce. La liste est écrite quelque part. L'apprentissage ne l'est presque jamais.

Cette asymétrie n'est pas de la paresse. C'est ce qui arrive quand un outil enregistre les livrables et que rien n'enregistre les réponses. Tous les systèmes de gestion de projet existants peuvent vous dire qu'une chose a été livrée. Très peu peuvent vous dire si elle a fonctionné, et presque aucun ne peut vous dire quel chiffre vous aviez convenu à l'avance pour en décider.

## Une preuve sans condition d'arrêt n'est qu'un lancement avec des étapes en plus

[De l'idée au réel](/blog/idea-to-real-the-operating-methodology) compte trois actes — Lire, Prouver, Créer — et celui du milieu porte l'opinion. Lire une idée ne coûte presque rien. Construire, si. Choisir quelle preuve vaut la peine d'être menée est la décision la plus lourde de conséquences du premier mois de n'importe quel projet, et les [huit façons de la concrétiser](/blog/eight-ways-to-make-an-idea-real) existent précisément pour que ce choix soit un vrai choix plutôt qu'un réglage par défaut.

```bf-figure
{
  "kind": "bars",
  "title": "Les huit preuves, selon ce qu'elles coûtent à mener",
  "max": 5,
  "rows": [
    { "label": "Vidéo de démo", "value": 1, "note": "un après-midi", "hue": "prove" },
    { "label": "Prototype cliquable", "value": 2, "note": "quelques jours", "hue": "prove" },
    { "label": "Smoke test", "value": 2, "note": "quelques jours · publie une adresse", "hue": "prove" },
    { "label": "Magicien d'Oz", "value": 2, "note": "quelques jours · un humain derrière le rideau", "hue": "prove" },
    { "label": "Ligne téléphonique", "value": 3, "note": "une semaine · un vrai numéro que les gens appellent", "hue": "build" },
    { "label": "Preuve de concept", "value": 3, "note": "une semaine", "hue": "build" },
    { "label": "Pilote", "value": 4, "note": "des semaines · de vrais utilisateurs, de vrais enjeux", "hue": "build" },
    { "label": "Système en production", "value": 5, "note": "des semaines de vraie ingénierie", "hue": "build" }
  ],
  "caption": "Chaque option est toujours proposée — il s'agit d'un conseil sur ce qu'il faut mener EN PREMIER, pas d'un filtre. En masquer une en ferait un verdict plutôt qu'une recommandation."
}
```

Chacune de ces huit preuves porte des critères de réussite que vous fixez *avant* de construire : 25 inscriptions pour 500 visiteurs, un taux de réussite de 90 % sur 20 essais, quatre utilisateurs pilotes sur cinq qui accomplissent la tâche sans aide. Ce chiffre, c'est la condition d'arrêt — le résultat qui mettrait fin au projet.

```bf-figure
{
  "kind": "flow",
  "title": "Où le chiffre est fixé, et où il est évalué",
  "steps": [
    { "label": "Prouver", "note": "Choisissez la preuve. Écrivez les critères : le chiffre qui vous ferait arrêter. Ne coûte rien, ne construit rien.", "hue": "prove", "tag": "fixe la condition" },
    { "label": "Créer", "note": "Menez la preuve. Un smoke test, un essai Magicien d'Oz, une ligne téléphonique, un pilote — ce que les critères exigeaient réellement.", "hue": "build", "tag": "payant" },
    { "label": "Mesurer", "note": "Évaluez-la. Atteint, manqué ou abandonné, avec le chiffre qui a tranché et la date à laquelle vous avez tranché.", "hue": "measure", "tag": "referme la boucle" }
  ],
  "caption": "La condition et l'évaluation se trouvent volontairement aux deux extrémités de la boucle. Un critère écrit après le résultat n'est pas un critère, c'est une légende."
}
```

Jusqu'à récemment, Builderforce faisait bien les deux premières étapes et laissait tout simplement tomber la troisième. Une concrétisation enregistrait ce qui avait été construit — les fichiers, les tickets, l'URL en ligne — et rien d'autre. Les consoles qui menaient la preuve connaissaient la réponse : la console de demande du smoke test comptait les inscriptions, le banc d'essai de la preuve de concept jugeait chaque essai. Toutes deux calculaient un verdict, l'affichaient à l'écran, puis le perdaient au rafraîchissement.

La plateforme pouvait donc dire *vous avez mené un smoke test*. Elle ne pouvait jamais dire *il a échoué et vous avez construit la chose quand même*.

## Ce qu'est un verdict

Une preuve enregistre désormais trois choses, et leur forme compte davantage que le fait qu'elles existent.

- **Le verdict** — `met`, `missed` ou `abandoned`. Trois valeurs, pas deux. Une preuve que personne n'a terminée n'est pas le même fait qu'une preuve qui a échoué, et les confondre embellit le bilan : les équipes abandonnent bien plus d'expériences qu'elles n'en ratent, et une seule de ces deux catégories constitue une preuve à propos de l'idée.
- **La métrique qui a tranché** — lue directement sur la console qui l'a mesurée, jamais ressaisie. Un chiffre qu'une personne saisit après coup est un chiffre qui s'accorde avec ce qu'elle croit désormais.
- **La date de la décision** — conservée séparément de la date de dernière modification de la fiche, pour que reconstruire la preuve le mois prochain ne puisse pas déplacer discrètement le moment où vous avez tranché.

L'enregistrer se fait en un bouton, qui n'apparaît qu'une fois que la console atteint un état permettant de décider : le compteur franchit le seuil, ou chaque essai a été jugé. Un bouton « enregistrer le verdict » disponible à tout moment serait une invitation à évaluer une preuve inachevée.

## Pourquoi c'est le chiffre auquel nous nous tenons

Chaque plateforme a sa métrique phare. La plupart mesurent l'activité : projets créés, agents exécutés, jetons consommés. Ces chiffres montent quand le produit est utilisé, que l'utilisateur en ait tiré quelque chose ou non.

La nôtre, c'est la part des idées qui atteignent une **preuve évaluée** — une construction dont la condition d'arrêt a réellement été mesurée, et pas simplement un livrable qui a été produit.

```bf-figure
{
  "kind": "compare",
  "title": "Deux façons de rendre compte du même trimestre",
  "columns": [
    { "title": "Ce que comptent la plupart des outils", "hue": "muted", "items": ["Projets créés", "Éléments déployés", "Tickets clos", "Heures de temps d'agent", "Autant de chiffres qui montent quand on n'apprend rien"] },
    { "title": "Ce que compte la méthode", "hue": "measure", "items": ["Preuves menées au regard de critères énoncés", "Verdicts enregistrés avec leur chiffre", "Idées abandonnées tôt, preuves à l'appui", "Idées poursuivies, preuves à l'appui", "Des chiffres qui peuvent baisser quand le produit est mal utilisé"] }
  ],
  "caption": "Une métrique qui ne peut pas baisser quand les choses tournent mal n'est pas une métrique, c'est un tableau d'affichage."
}
```

C'est un chiffre volontairement inconfortable. Il baisse quand les gens construisent sans prouver — exactement au moment où nous voulons le voir baisser.

## La boucle, en pratique

Voici ce que cela change à un lundi.

Vous collez un brief. Il revient sous forme de spécification — ce que la chose doit faire, les capacités mentionnées, les limites posées par le brief lui-même. Huit preuves sont classées au regard de cette spécification, de la moins chère à la plus chère, et la recommandation explique *pourquoi* celle-ci répond à la question que pose réellement le brief. Vous en choisissez une, écrivez le chiffre qui vous ferait arrêter, et vous la construisez. Elle est publiée à une adresse que vous pouvez envoyer à quelqu'un.

Deux semaines plus tard, la console indique 9 inscriptions pour 512 visiteurs, face à un seuil de 25. Vous cliquez sur enregistrer. Le verdict est `missed`, la métrique est stockée à côté, et la date est celle du jour.

Et vient ensuite la partie utile : cette réponse retourne à Idée. Pas sous la forme d'une impression du genre « le coup de la landing page n'a pas vraiment marché », mais comme une ligne que vous pouvez placer sur un tableau à côté de la version suivante de l'idée, et à côté des quatre autres choses que vous avez tentées ce trimestre.

Une preuve sans condition susceptible d'échouer n'est qu'un lancement avec des étapes en plus. Une preuve dont personne n'évalue la condition n'est qu'un lancement avec de la paperasse en plus. C'est le troisième acte qui donne tout leur sens aux deux premiers.

---

**À lire aussi :** [De l'idée au réel — la méthodologie opérationnelle](/blog/idea-to-real-the-operating-methodology) · [Huit façons de concrétiser une idée](/blog/eight-ways-to-make-an-idea-real) · [Lire, Prouver, Créer — la boucle interne](/blog/read-prove-build-the-inner-loop)

Commencez là où commence la méthode : [ouvrez un canevas](/create) et collez l'idée dont vous débattez depuis trop longtemps.
