« Rendre une idée réelle » ne recouvre pas une seule chose. Cela en recouvre au moins huit, qui diffèrent énormément en fidélité comme en coût — et mal choisir entre elles est l'erreur la plus coûteuse que l'on puisse commettre au cours du premier mois d'un projet.

La plupart des outils ne proposent qu'une seule réponse : construire le système. C'est la preuve la plus coûteuse qui soit, et pour la plupart des questions qu'une entreprise se pose réellement, c'est la mauvaise. « Pouvez-vous me montrer ? » n'exige pas un système opérationnel. « Est-ce que quelqu'un en veut ? » trouve sa réponse dans une landing page et un chiffre — et y répondre avec un système complet, c'est ainsi qu'on passe six semaines sur quelque chose que personne n'a demandé.

Voici donc les huit, ce à quoi chacune répond, et où chacune se situe sur les deux axes qui comptent.

## La carte

```bf-figure
{
  "kind": "matrix",
  "title": "Fidélité et effort",
  "xLabel": "Effort  ·  1 = un après-midi,  5 = des semaines",
  "yLabel": "Fidélité  ·  1 = une esquisse,  5 = le produit lui-même",
  "max": 5,
  "points": [
    { "label": "Vidéo de démo", "x": 1, "y": 1, "hue": "read", "dx": 10, "dy": -12 },
    { "label": "Prototype cliquable", "x": 2, "y": 2, "hue": "read", "dx": -12, "dy": 20 },
    { "label": "Smoke test", "x": 2, "y": 2, "hue": "prove", "dx": 12, "dy": -12 },
    { "label": "Magicien d'Oz", "x": 2, "y": 3, "hue": "prove", "dx": 12, "dy": -10 },
    { "label": "Preuve de concept", "x": 3, "y": 3, "hue": "prove", "dx": 12, "dy": 18 },
    { "label": "Ligne téléphonique", "x": 3, "y": 4, "hue": "build", "dx": 12, "dy": -12 },
    { "label": "Pilote", "x": 4, "y": 4, "hue": "build", "dx": 12, "dy": 20 },
    { "label": "Système en production", "x": 5, "y": 5, "hue": "make", "dx": -12, "dy": -14 }
  ],
  "caption": "Le prototype cliquable et le smoke test occupent réellement les mêmes coordonnées — même fidélité, même effort — et leurs étiquettes s'écartent l'une de l'autre pour rester lisibles. Ils coûtent autant et répondent à des questions complètement différentes, et c'est précisément le propos : le coût ne vous dit pas quelle preuve mener, seulement lesquelles vous pouvez vous permettre de rater."
}
```

Lisez le coin inférieur gauche comme un repère, pas comme un classement. Rien de ce qui s'y trouve n'est une preuve au rabais : c'est une réponse moins chère à une question plus étroite. Réaliser une vidéo de démo n'est jamais une *erreur*.

## Les huit, et la question à laquelle chacune sert vraiment

**Vidéo de démo** — *« Pouvez-vous me montrer de quoi il s'agit ? »* Un montage minuté et un script de narration, pour qu'une démo de quatre-vingt-dix secondes prête à enregistrer existe dès aujourd'hui. Fidélité 1, effort 1. C'est la réponse quand la personne qui pose la question est une partie prenante, un investisseur ou un collègue qui a besoin de se représenter la chose. Construire un système pour y répondre est une erreur de catégorie.

**Prototype cliquable** — *« Quelqu'un peut-il vraiment aller jusqu'au bout sans aide ? »* Un parcours cliquable et instrumenté, sans backend ni données. Fidélité 2, effort 2. Un prototype qui nécessite un déploiement n'est pas un prototype ; toute sa valeur tient à ce qu'il tourne sur n'importe quel portable, devant une vraie personne, cet après-midi même.

**Smoke test** — *« Est-ce que quelqu'un en veut vraiment ? »* Une landing page « fausse porte », une liste d'attente et une console de suivi de la demande, jugées au regard d'un seuil fixé à l'avance. Fidélité 2, effort 2. Le seuil, c'est tout le test. Sans lui, vous avez une landing page et une impression.

**Magicien d'Oz** — *« Le résultat vaut-il qu'on paie pour lui, avant même qu'on sache l'automatiser ? »* Une vraie interface avec un humain derrière, soumis à un SLA, qui emprunte les mêmes routes que celles qu'utilisera le système construit. Fidélité 3, effort 2. Absurdement sous-utilisé, parce que cela ressemble à de la triche. Ce n'en est pas : c'est séparer « est-ce que cela a de la valeur » de « peut-on l'automatiser », deux questions qui échouent pour des raisons différentes.

**Preuve de concept** — *« La partie difficile fonctionne-t-elle vraiment, de façon suffisamment fiable ? »* L'étape la plus risquée isolée derrière un banc d'essai, avec un taux de réussite jugé au regard d'un seuil fixé à l'avance. Fidélité 3, effort 3. Notez la forme : un *taux de réussite*, pas une démo. Une exécution réussie ne prouve rien pour une étape qui doit fonctionner huit fois sur dix.

**Pilote** — *« Cela tient-il la route avec de vraies personnes, à une échelle où nous pouvons nous permettre d'avoir tort ? »* Une exécution bornée avec une cohorte identifiée, une boucle de retours hebdomadaire et des critères de sortie écrits. Fidélité 4, effort 4. Ce sont les critères de sortie qui empêchent un pilote de devenir discrètement la production.

**Ligne téléphonique** — *« Les clients peuvent-ils nous joindre par téléphone, et pouvons-nous les joindre ? »* Un numéro entrant qui décroche et comprend, plus un endpoint qui passe des appels sortants. Fidélité 4, effort 3. Moins cher que le pilote à côté et d'une fidélité bien supérieure à ce que son coût laisse penser, car un numéro qui répond est indiscutablement réel pour la personne qui l'appelle.

**Système en production** — *« Est-ce que cela tourne vraiment, et savons-nous l'exploiter ? »* Le système complet à une vraie adresse, avec une console d'exploitation et un runbook d'astreinte. Fidélité 5, effort 5. Notez la seconde moitié de la question. Un système que personne ne sait exploiter n'est pas terminé ; c'est un passif qui, jusqu'ici, affiche une bonne disponibilité.

## Ce que fait réellement le classement

```bf-figure
{
  "kind": "bars",
  "title": "L'effort, par ordre croissant — la recommandation par défaut, avant la lecture de tout brief",
  "max": 5,
  "rows": [
    { "label": "Vidéo de démo", "value": 1, "note": "un après-midi", "hue": "read" },
    { "label": "Prototype cliquable", "value": 2, "note": "un jour ou deux", "hue": "read" },
    { "label": "Smoke test", "value": 2, "note": "un jour ou deux", "hue": "prove" },
    { "label": "Magicien d'Oz", "value": 2, "note": "un jour ou deux", "hue": "prove" },
    { "label": "Preuve de concept", "value": 3, "note": "quelques jours", "hue": "prove" },
    { "label": "Ligne téléphonique", "value": 3, "note": "quelques jours", "hue": "build" },
    { "label": "Pilote", "value": 4, "note": "des semaines", "hue": "build" },
    { "label": "Système en production", "value": 5, "note": "des semaines de véritable ingénierie", "hue": "make" }
  ],
  "caption": "Le coût pèse à lui seul quarante pour cent du score de classement, avant toute correspondance de capacités. Sans ce terme, un brief citant cinq capacités ferait toujours ressortir la preuve qui en couvre le plus — c'est-à-dire, invariablement, la plus lourde."
}
```

Lorsque vous collez un brief, le classement combine l'adéquation des capacités **et** une préférence permanente pour le moins cher plutôt que le plus cher. Un brief qui mentionne « voix » pointe réellement vers la ligne téléphonique, et le terme d'adéquation le dira. Mais un brief qui cite cinq éléments pointe vers cinq preuves, et sans le terme de coût, la recommandation se réduit à « construisez tout », à chaque fois, déguisée en analyse.

Le classement suit deux autres règles, qui existent toutes deux parce que l'alternative est pire :

- **Chaque cible est toujours renvoyée, avec ses raisons.** Un score sans raisons n'est pas un conseil, c'est un verdict — et un fondateur doit pouvoir discuter un conseil.
- **Une cible sans liste de capacités est universelle, pas hors sujet.** Noter « ne correspond à rien » par un zéro enterrerait la vidéo de démo, qui est pourtant la bonne première réponse pour la plupart des briefs.

## Bien choisir

La question pratique n'est pas « quelle est la meilleure preuve ». C'est **à quelle question suis-je prêt à consacrer de l'argent, et quel résultat me ferait arrêter ?**

```bf-figure
{
  "kind": "flow",
  "title": "Une décision qui se prend en une minute environ",
  "steps": [
    { "label": "Nommez le doute", "note": "Pas la fonctionnalité — le doute. « Personne n'en veut », « le modèle n'est pas assez précis », « les gens n'arrivent pas au bout du parcours », « cela ne résistera pas à une vraie charge ».", "hue": "read" },
    { "label": "Choisissez la preuve qui s'y attaque", "note": "Demande → smoke test. Compréhension → prototype cliquable. Risque technique → preuve de concept. Valeur avant automatisation → magicien d'Oz.", "hue": "prove" },
    { "label": "Écrivez le chiffre d'abord", "note": "Le seuil, le taux de réussite, le taux d'achèvement, les critères de sortie. Avant de construire, pas une fois le résultat connu.", "hue": "prove", "tag": "non négociable" },
    { "label": "Menez-la, et respectez le chiffre", "note": "Un seuil que l'on renégocie après avoir vu le résultat n'a jamais été un seuil.", "hue": "build" }
  ]
}
```

C'est à cette dernière étape que la plupart des validations échouent réellement. La preuve est menée, le chiffre tombe en dessous, et le chiffre bouge. L'écrire à l'avance ne rend personne honnête — mais cela rend la malhonnêteté visible, et il se trouve que c'est l'essentiel du travail.

## Quand le niveau de fidélité ne dit pas tout

Une mise en garde à propos de la carte. La fidélité mesure à quel point la preuve est proche du produit réel, pas à quel point elle est *convaincante*. Une vidéo de démo de quatre-vingt-dix secondes, de fidélité 1, fera davantage avancer un investisseur qu'une preuve de concept de fidélité 3, car la question de l'investisseur était « pouvez-vous me montrer », et la PoC a répondu à une question qu'il n'avait jamais posée.

Adaptez la preuve à la personne qui pose la question, pas à l'axe.

---

*[Commencez par un canevas](/create/new) et décrivez l'idée — une fois connecté, `/realize` la lit et classe les huit options au regard de celle-ci ; la lecture ne construit rien, le classement ne vous coûte donc rien à consulter. Ou découvrez la méthode dans laquelle elles s'inscrivent : [De l'idée au réel](/blog/idea-to-real-the-operating-methodology).*
