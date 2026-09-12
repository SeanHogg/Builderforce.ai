Ouvrez presque n'importe quelle plateforme professionnelle : le menu de gauche est un organigramme. Ventes. Marketing. Finance. Ingénierie. RH. C'est une liste parfaitement raisonnable, et elle répond à une question que seule une entreprise existante peut se poser : *ce service, il dépend de quel département ?*

Quelqu'un qui arrive avec une idée ne peut pas répondre à cette question. Il n'a pas de départements. Il a une chose qu'il veut créer, et aucune idée de la suite.

Builderforce regroupe donc ses destinations selon **l'endroit où vous en êtes dans le parcours**.

```bf-figure
{
  "kind": "stack",
  "title": "Chaque destination se trouve dans exactement l'une de ces étapes",
  "bands": [
    { "label": "Idée", "note": "Et si ? — Canevas. Une seule ligne, parce qu'à ce stade il n'y a qu'une chose à faire.", "hue": "idea", "tag": "public" },
    { "label": "Créer", "note": "Construisez-le. — Projets, Effectif, Qualité, Fiabilité, Connaissances, Embarqué.", "hue": "make" },
    { "label": "Piloter", "note": "Faites-en une entreprise. — Finance, Revenus, Équipes, Recrutement, Investisseurs, Gouvernance, Support, Croissance, Boîte de réception.", "hue": "run" },
    { "label": "Mesurer", "note": "Est-ce que ça marche ? — Analyses : livraison, autonomie, finance, DevEx, conformité, alertes.", "hue": "measure" },
    { "label": "Portée", "note": "Vendez-le, faites-vous trouver, développez-le. — la Marketplace comme seconde porte d'entrée, et le programme commercial propre à chaque compte.", "hue": "reach", "tag": "public" }
  ],
  "caption": "Administration est la sixième, et elle est volontairement terne. Personne ne parcourt les paramètres d'un produit avant de s'inscrire. Portée comptait autrefois deux bandes — Marché et Développer — jusqu'à ce que la seconde ne contienne plus qu'une seule ligne ; un titre avec un seul élément dessous, c'est une étiquette, pas une architecture."
}
```

L'ordre est l'argument. Lisez-le de haut en bas : c'est une phrase qui raconte comment une entreprise voit le jour.

## Ce que cela a remplacé, et pourquoi ce n'était pas qu'une question de désordre

Cela mérite d'être précis, car « nous avons réorganisé la navigation » est la phrase la moins intéressante du logiciel — et ce n'était pas de cela qu'il s'agissait.

Il existait **quatre** listes distinctes déclarant des destinations navigables. Une pour le rail des utilisateurs connectés. Une pour les pages marketing. Une pour les domaines du modèle de données. Une pour le pied de page. Le CFO existait quatre fois, sous quatre noms — et l'une de ces quatre entrées faisait *sortir du produit* un client connecté pour l'emmener sur une page marketing décrivant l'outil qu'il utilisait déjà.

Ce n'est pas un problème esthétique. C'est quelqu'un qui perd sa session pour lire une brochure sur son propre espace de travail.

```bf-figure
{
  "kind": "compare",
  "title": "Quatre listes, ou une seule",
  "columns": [
    {
      "title": "Quatre registres",
      "hue": "bad",
      "items": [
        "Le rail disait « Finance » ; le menu disait « Business Intelligence ».",
        "Des destinations entières n'avaient aucune ligne marketing : le menu présentait un produit plus petit que celui livré.",
        "Le pied de page listait un identifiant que rien ne déclarait et affichait silencieusement une colonne tronquée.",
        "Chaque correction devait être faite à quatre endroits, et le quatrième était toujours découvert plus tard."
      ]
    },
    {
      "title": "Un seul registre, projeté",
      "hue": "good",
      "items": [
        "Le rail, les menus, le pied de page et /features lisent tous le même tableau.",
        "Une capacité que le produit n'a pas ne peut pas apparaître sur le site marketing.",
        "La question d'une étape n'a qu'un seul foyer, affiché à l'identique partout où elle apparaît.",
        "Un script de build échoue si une deuxième liste apparaît. La règle est appliquée, pas mémorisée."
      ]
    }
  ]
}
```

La dernière ligne est celle qui fait tenir l'ensemble. La suite de tests contient une vérification qui parcourt chaque fichier source à la recherche d'un objet portant à la fois un champ ressemblant à une route et un champ ressemblant à un libellé — une destination sous un autre nom — et fait échouer le build si elle en trouve un en dehors du registre. Des exemptions existent, et chacune doit être accompagnée d'une phrase écrite expliquant pourquoi une ligne du registre ne pouvait pas couvrir ce cas.

Un *compteur* laisserait la dette s'installer en ayant l'air d'un progrès. Une *liste de raisons* oblige l'auteur suivant à dire à voix haute pourquoi son exception en est une.

## Le site marketing est une projection

Voici la partie qui compte le plus pour quiconque lit le site plutôt qu'il n'utilise le produit : **`/features` est généré à partir de ce même registre.**

Le tableau des étapes, les pastilles des destinations, les compteurs de la carte de synthèse — tout est calculé. La page ne peut donc pas vanter une destination qui n'existe pas, ni en oublier une qui existe. Un chiffre marketing qui s'écarte du produit est le mensonge le moins cher à publier et, de loin, le plus coûteux à repérer.

```bf-figure
{
  "kind": "flow",
  "title": "Une déclaration, quatre consommateurs",
  "steps": [
    { "label": "Le registre", "note": "Un seul tableau. Chaque ligne indique son responsable (quel rôle), son étape (où elle se situe dans l'arc) et le palier auquel elle s'active.", "hue": "make" },
    { "label": "Le panneau de gauche", "note": "Regroupe par étape. Les lignes au-dessus de votre palier sont atténuées, jamais masquées — une ligne atténuée est une invitation, une ligne absente est un secret.", "hue": "run" },
    { "label": "Les menus publics", "note": "Produit ▾ affiche Idée · Créer · Piloter · Mesurer. Apprendre ▾ affiche Lire · Prouver · Construire avec.", "hue": "read" },
    { "label": "/features", "note": "Les mêmes lignes, cette fois sous forme de tableau, avec la question à laquelle répond chaque étape et un lien par destination.", "hue": "measure" }
  ],
  "caption": "Les trois colonnes du menu Apprendre sont les trois actes de la méthode qui portent une seconde casquette — lire, prouver, construire avec. Cet écho n'est pas décoratif ; c'est la même posture, appliquée au fait d'apprendre à connaître le produit plutôt qu'au fait de créer quelque chose avec."
}
```

## La divulgation progressive, et pourquoi rien n'est caché

Une ligne est **toujours listée**. Ce que le parcours conditionne, c'est son *état*, pas son existence.

Quelqu'un sans compte voit tout : le CFO, le Recruteur, la surface de gouvernance, l'ensemble de l'équipe — atténués, avec une ligne honnête et un unique bouton de configuration qui renvoie vers le responsable de ce dont il aurait besoin en premier. Le bouton du CFO vous confie au CEO, parce que le CEO est responsable de la création de l'entreprise et que le CFO ne peut pas exister avant l'entreprise.

Le raisonnement tient en une phrase : **personne ne réclame une capacité qu'il n'a jamais vue.** Masquer les surfaces métier jusqu'à ce que quelqu'un « remplisse les conditions » transforme une rampe d'accès en porte verrouillée, et la personne qui reste du mauvais côté ne découvre jamais ce qu'il y avait derrière.

Et il n'est pas obligatoire de gravir tout le parcours. S'arrêter en chemin est une utilisation complète et réussie du produit. Quelqu'un qui publie trois landing pages et ne crée jamais d'entreprise n'a pas raté son onboarding — il a obtenu ce qu'il était venu chercher.

## La seule chose qu'une étape ne peut pas être

Une étape n'est pas un département, et la tentation d'en faire un est permanente. Le test le plus clair appliqué par l'équipe : **s'agit-il d'une phase de travail, ou d'un groupe de personnes ?**

« IA » a échoué à ce test, et c'est pourquoi il n'existe pas de section IA. Ses destinations sont allées aux rôles qui portent le travail — la catégorisation des dépenses à la Finance, l'analyse des contrats à la Gouvernance, la veille concurrentielle à la Croissance, les retours sur le pitch deck au CEO. Une entrée de menu nommée d'après une technologie vous dit de quoi le logiciel est fait. Les rôles vous disent à quoi il sert.

Même test, même réponse pour « Rapports », « Automatisation » et « Intégrations ». Chacun est une propriété de nombreuses destinations, pas un lieu.

---

*Découvrez l'arc complet, généré en direct, sur [la page des fonctionnalités](/features), ou passez la visite et [commencez par Idée](/create/new). La méthode que portent ces étapes est détaillée dans [De l'idée au réel](/blog/idea-to-real-the-operating-methodology).*
