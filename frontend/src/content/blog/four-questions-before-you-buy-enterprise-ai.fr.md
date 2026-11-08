# Les quatre questions sur lesquelles repose réellement un achat d’IA d’entreprise

Toute évaluation d’IA en entreprise commence comme une conversation sur les modèles et finit comme une conversation sur quatre sujets qui n’ont rien à voir avec les modèles.

Les clients ne nous demandaient pas un meilleur modèle. Ils posaient ces questions :

```bf-figure
{
  "kind": "stack",
  "title": "Les quatre questions, dans l’ordre où on les pose",
  "bands": [
    { "label": "Peut-elle lire nos données ?", "note": "Pas un corpus de démonstration. Nos exports, nos documents, nos tickets, nos politiques, dans les formats où ils se trouvent réellement.", "hue": "idea" },
    { "label": "Va-t-elle fuiter entre tenants ?", "note": "Pas « nous filtrons par identifiant client ». Que se passe-t-il quand le filtre est absent ?", "hue": "run" },
    { "label": "Combien cette réponse a-t-elle coûté ?", "note": "Par réponse, imputable, pas une facture mensuelle avec un seul chiffre dessus.", "hue": "measure" },
    { "label": "Comment savons-nous qu’elle s’améliore ?", "note": "Une barrière qu’un changement doit franchir, pas un journal des modifications qui affirme qu’il y a eu amélioration.", "hue": "prove" }
  ],
  "caption": "Un fournisseur qui répond bien à trois de ces questions et esquive la quatrième vous demande de prendre la quatrième sur parole, et c’est celle qui décide si la chose est encore bonne dans un an."
}
```

Voici à quoi ressemble chaque réponse quand elle est réelle.

## 1 · L’ingestion est un chemin unique, pas une démo unique

Le mode de défaillance est un système qui lit parfaitement le Markdown et traite tout le reste comme une pièce jointe. Les vrais corpus sont hétérogènes : documents de politique, tickets exportés, tableurs, pages HTML, un CSV produit à partir d’un rapport il y a six ans.

Un seul pipeline les traite tous, et la différence entre eux tient à l’analyseur qui a été exécuté, pas au produit que vous avez dû acheter. Les lignes structurées et la prose non structurée atterrissent dans le même index par le même chemin, ce qui permet de répondre à une question à partir des deux à la fois.

Des détails qui s’avèrent importants en pratique : conserver le fil d’Ariane des titres d’un document pour qu’un fragment récupéré sache d’où il vient, et récupérer les nombres et les booléens des tableurs **sans** altérer les chaînes ayant la forme d’identifiants. Un identifiant `007` n’est pas le nombre sept, et un système qui en décide autrement corrompt en silence toutes les références à celui-ci.

## 2 · Le cloisonnement des tenants est compilé et échoue de manière fermée

```bf-figure
{
  "kind": "compare",
  "title": "Deux manières d’empêcher un client d’accéder aux données d’un autre",
  "columns": [
    { "title": "Un filtre ajouté au point d’appel", "hue": "bad", "items": ["Correct dans chaque chemin de code dont quelqu’un s’est souvenu", "Un nouveau chemin de code est une nouvelle occasion d’oublier", "La défaillance est silencieuse et ressemble à une bonne réponse", "Vous l’apprenez par le client"] },
    { "title": "Compilé dans la récupération, échec fermé", "hue": "good", "items": ["Une requête sans périmètre de tenant ne renvoie rien", "Les filtres sont des DONNÉES que l’adaptateur doit respecter", "Les lectures inter-tenants sont DÉCLARÉES, jamais accidentelles", "L’absence de périmètre est une erreur, pas un joker"] }
  ],
  "caption": "La propriété à exiger lors d’une démo : demandez ce qui se passe quand le périmètre du tenant est absent. « Tout » et « rien » sont deux produits très différents."
}
```

## 3 · Coût et trace sur chaque réponse

Un système d’IA dont le coût arrive sous forme d’un seul chiffre mensuel ne peut pas être géré. Vous ne pouvez pas savoir quel flux de travail est coûteux, quelle équipe le génère, ni si la réponse valait les jetons.

La télémétrie par réponse — ce qui a été récupéré, ce qui a été appelé, ce que cela a coûté — transforme cela en quelque chose qu’une fonction financière peut tenir et qu’une équipe d’ingénierie peut améliorer. C’est aussi ce qui rend la quatrième question accessible, car on ne peut pas démontrer qu’un changement était une amélioration sans une référence que l’on enregistrait déjà.

## 4 · Une barrière d’évaluation, pas un journal des modifications

La version honnête de « elle s’améliore » est un ensemble de cas que le système doit réussir avant qu’un changement soit livré, exécuté à chaque changement, avec les échecs visibles. Pas un score de benchmark dans un billet de lancement : une barrière dans le pipeline capable de dire *non*.

C’est la question que la plupart des fournisseurs gèrent le plus mal, car c’est la seule qui les contraint. Une barrière qui peut bloquer une version est une barrière qui finira par bloquer une version que quelqu’un voulait.

## Et l’aspect ennuyeux : la façon dont les gens se connectent

L’authentification unique d’entreprise est en service via OpenID Connect, orientée vers le fournisseur d’identité que le client exploite déjà.

Nous ne terminons délibérément pas SAML nous-mêmes. La partie difficile de SAML est la vérification d’une réponse signée — canonisation, validation du condensat, vérification de la signature, avec des revendications lues depuis le sous-arbre effectivement vérifié — et une erreur n’importe où dans cette séquence est un contournement d’authentification par encapsulation de signature dont la propriété déterminante est qu’il ressemble exactement à une connexion qui fonctionne jusqu’à ce que quelqu’un falsifie une assertion. Les clients dirigent leur IdP existant vers une passerelle SSO de leur choix ; rien dans notre schéma ne nomme un fournisseur.

Être clair sur ce que l’on a choisi de *ne pas* implémenter fait partie de la réponse à la deuxième question.

---

**À lire aussi :** [Evermind — le modèle auto-actualisé](/blog/evermind-self-updating-model) · [Dans l’architecture d’Evermind](/blog/inside-evermind-architecture) · [Sécurité et architecture multi-tenant](/blog/security-and-multi-tenant-architecture)

Lisez la [présentation d’Evermind](/evermind), ou apportez ces questions dans une [conversation](/book-demo).
