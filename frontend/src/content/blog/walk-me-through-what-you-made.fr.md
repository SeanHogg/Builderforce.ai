Collez un business plan dans un canevas, adressez-le à cinq de vos agents, et allez vous faire un café.

Quatre minutes plus tard, vingt-quatre objets occupent le tableau. Un profil d'entreprise. Six concurrents, chacun avec une estimation de chiffre d'affaires documentée et un siège social. Deux segments de clientèle, dimensionnés. Un plan de mise sur le marché. Un modèle de tarification. Une carte sur laquelle figure la géographie concurrentielle.

C'est le produit qui fonctionne exactement comme prévu — et c'est aussi le moment où, nous disent les utilisateurs, ils restent figés.

> C'est impressionnant. Je ne sais pas quoi en faire.

Ce n'est pas un reproche adressé à la recherche. C'est un reproche adressé à l'arrivée. Vingt-quatre objets, c'est plus que ce que quiconque peut lire d'un coup, et un tableau ne vous donne aucune raison de regarder une carte plutôt qu'une autre en premier.

## Ce qui n'allait vraiment pas

Trois choses, et une seule relevait de l'explication.

```bf-figure
{
  "kind": "compare",
  "title": "Pourquoi un tableau généré donnait l'impression d'un mur",
  "columns": [
    { "title": "Ce que vous voyiez", "hue": "muted", "items": ["Un long ruban de cartes débordant en bas de l'écran", "Les deux tiers d'un écran large vides à côté", "Six cartes d'agent empilées au même point, qui semblaient n'en faire qu'une", "Le même concurrent étudié deux fois", "Aucune indication de ce qu'il fallait ouvrir en premier"] },
    { "title": "Ce qui se passait", "hue": "make", "items": ["Le placement ne savait grandir que vers le bas, jamais en largeur", "Rien ne mesurait la largeur réelle du tableau", "Les objets ajoutés dans le même cycle prenaient tous la même coordonnée", "Un tour interrompu par sa limite de sortie refaisait ce qu'il ne voyait plus", "Rien sur le tableau ne savait se présenter"] }
  ],
  "caption": "Les quatre premiers sont des bugs de placement, et ils sont corrigés. Le cinquième est celui qui exigeait quelque chose de nouveau."
}
```

La moitié liée au placement mérite une phrase, car c'est la moins intéressante et c'est elle qui faisait le plus de dégâts. Les nouveaux objets étaient placés en descendant depuis un point de départ jusqu'à trouver un espace libre — un raisonnement valable pour une carte, mais faux pour un lot. Dix objets créés en un seul tour, sans coordonnées, chacun placé par rapport aux neuf précédents, produisent une colonne étroite. Sur un écran de 3440 pixels, cela donne un ruban qui laisse la majeure partie de l'écran inutilisée — c'est exactement le signalement que nous avons reçu.

Les objets remplissent désormais la largeur dont dispose réellement le tableau avant de s'étendre vers le bas, et cette largeur, le canevas la mesure au lieu de la supposer.

## La visite guidée

Le canevas avait déjà une visite guidée. Elle présentait l'*interface* : voici le dock Brain, voici la palette, voici Partager. C'est la bonne visite pour votre premier tableau, et elle ne dit absolument rien de votre travail.

Il y en a donc une seconde, qui parcourt les artefacts.

```bf-figure
{
  "kind": "flow",
  "title": "Comment la visite décide de ce qu'elle vous montre",
  "steps": [
    { "label": "Regrouper", "note": "Par type, pas par carte. Six concurrents forment une seule réponse — voici face à qui vous vous trouvez — et non six étapes.", "hue": "read" },
    { "label": "Ordonner", "note": "Selon les connexions du tableau lui-même. Ce qui alimente quoi est déjà tracé sur le canevas : la visite suit ce tracé, et revient à l'ordre de lecture quand rien n'est connecté.", "hue": "read" },
    { "label": "Parcourir", "note": "Le tableau se déplace vers chaque groupe tour à tour et dit ce qu'il est, avec les propres mots de l'objet plutôt qu'une légende générique.", "hue": "make", "tag": "sur le tableau" }
  ],
  "caption": "Rien ici n'est un ordre de passage écrit à la main. Un nouveau type d'objet rejoint la visite dès le jour où il peut être créé, parce que la visite est déduite du tableau au lieu d'être listée quelque part."
}
```

Le regroupement est la décision qui fait tout fonctionner. Une étape par objet, c'est le même mur avec un bouton Suivant — vingt-quatre étapes, c'est pire que vingt-quatre cartes, parce que vous ne pouvez même plus survoler. Vingt-quatre objets répartis en neuf types, ce sont neuf choses qui méritent d'être dites, dont l'une est : *ces six-là ont été étudiés ensemble ; lisez-les comme un ensemble, c'est la comparaison qui compte.*

```bf-figure
{
  "kind": "screen",
  "frame": "Étape 3 sur 8",
  "ratio": 1.62,
  "regions": [
    { "label": "6 objets concurrents", "note": "Le groupe mis en avant, ramené dans le champ de vision", "x": 4, "y": 10, "w": 58, "h": 56, "hue": "make" },
    { "label": "Ce qu'est ce groupe", "note": "Nommé à partir de la phrase rédigée par l'objet lui-même, jamais d'un résumé inventé", "x": 66, "y": 16, "w": 30, "h": 34, "hue": "idea" },
    { "label": "Le reste du tableau", "note": "Toujours visible, toujours à vous", "x": 4, "y": 70, "w": 58, "h": 18, "hue": "muted" },
    { "label": "Précédent · Suivant · quittez à tout moment", "x": 66, "y": 54, "w": 30, "h": 8, "hue": "accent" }
  ],
  "caption": "La mise en lumière suit désormais une carte vers laquelle le canevas est encore en train de se déplacer. Auparavant, elle ne mesurait qu'une fois, à la première image, et restait figée là où se trouvait la carte."
}
```

Elle est proposée une seule fois par tableau, sur les tableaux suffisamment remplis pour qu'on s'y perde — un canevas de trois cartes n'a pas besoin de guide, et en proposer un donnerait l'impression que le produit ne vous fait pas confiance. Ensuite, elle reste accessible dans la barre de commandes, à côté des diagnostics et du tableau de résultats, car elle répond à la même question qu'eux : *qu'est-ce que j'ai réellement sous les yeux ?*

## Deux doublons qui n'étaient jamais de votre fait

Pendant que nous y étions, le même compte rendu de session montrait le même concurrent deux fois sur le tableau, et un agent trois fois. Aucun des deux n'était un échec de la recherche.

**Un siège est une identité, pas un événement.** Adresser deux fois le même coéquipier installait auparavant deux cartes portant le même nom. Désormais, cela ramène simplement dans le champ de vision celle que vous avez déjà.

**Un modèle interrompu refait son travail.** Lorsqu'un tour atteint sa limite de sortie en pleine phrase, la tentative suivante n'a plus sa propre transcription pour vérifier — elle rédige donc à nouveau le profil de l'entreprise. Le tableau, lui, le voit encore : c'est donc désormais lui qui répond. Un objet de même type et de même nom vous renvoie l'identifiant de celui qui existe déjà, avec l'instruction de le mettre à jour. Les post-it font exception, car un mur de post-it peut tout à fait en compter trois qui disent Tarifs.

## Sa place dans la méthode

[Lire vient avant Prouver, et Prouver avant Créer](/blog/read-prove-build-the-inner-loop) — tout l'intérêt de cet ordre étant que lire coûte peu et que créer coûte cher, si bien que la décision de créer doit être une décision éclairée.

Nous sommes ici en plein dans **Lire**, et cela comble un manque qui s'y était creusé. Nous avions rendu la *production* des éléments quasiment gratuite : un prompt, quatre minutes, un paysage concurrentiel documenté avec ses sources. Ce que nous n'avions pas rendu gratuit, c'était leur *assimilation*. Un paysage que personne ne lit n'éclaire aucune décision : une étape Lire qui produit plus qu'une personne ne peut absorber a discrètement échoué dans la seule chose pour laquelle elle existe — et elle échoue de manière invisible, parce que le tableau paraît impressionnant dans tous les cas.

```bf-figure
{
  "kind": "compare",
  "title": "La distance entre généré et compris",
  "columns": [
    { "title": "Avant", "hue": "muted", "items": ["Vingt-quatre cartes apparaissent", "Vous en ouvrez une au hasard", "Vous tentez de comprendre ce que forme l'ensemble", "Vous passez complètement à côté des segments", "Vous demandez à Brain ce qu'il a créé"] },
    { "title": "Désormais", "hue": "read", "items": ["Vingt-quatre cartes apparaissent, réparties sur toute la largeur de l'écran", "Vous cliquez sur Faites-moi visiter", "Huit étapes, dans l'ordre que le tableau lui-même suggère", "Vous quittez à n'importe quelle étape pour vous mettre au travail"] }
  ],
  "caption": "Lire ne coûte peu que si la lecture a réellement lieu. C'est toute la différence entre des éléments produits et des éléments lus."
}
```

## Ce que vous pouvez en faire dès aujourd'hui

- **Posez une grande question et obtenez une réponse lisible** — les objets arrivent répartis sur toute la largeur de votre écran au lieu de s'empiler vers le bas.
- **Cliquez sur Faites-moi visiter** quand un tableau revient plus rempli que prévu, et quittez la visite à l'étape où vous en avez assez vu.
- **Revenez-y plus tard** depuis la barre de commandes, sur n'importe quel tableau, autant de fois que vous le souhaitez.
- **Arrêtez de dédoublonner à la main** — le même concurrent, la même entreprise ou le même coéquipier n'arrive plus deux fois.

---

**À lire aussi :** [Le Canvas de création n'est pas une fenêtre de chat](/blog/creation-canvas-beyond-chat) · [Brain pilote le Canvas de création](/blog/brain-operates-the-creation-canvas) · [Lancez l'application que votre tableau vient de créer](/blog/run-your-app-on-the-canvas)

[Ouvrez un canevas](/create) et posez-lui une question assez vaste pour mériter une visite guidée.
