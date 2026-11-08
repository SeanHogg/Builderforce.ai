# Quatre bandes d’interface supprimées

Ouvrez un canevas et le tableau est le produit. Tout le reste — le titre, le sélecteur de surface, la liste des participants, l’état d’enregistrement, les sept boutons — n’est que de l’échafaudage autour.

Pendant longtemps, cet échafaudage a été organisé en **bandes** : des bandes pleine largeur empilées le long de la fenêtre, chacune traçant une ligne dure, chacune prenant de la hauteur à ce pour quoi les gens étaient venus. Le pire coupable était une barre de session de 54 pixels portant un titre, un sélecteur, sept boutons, une liste de participants et un bouton d’enregistrement étalés sur toute une fenêtre : surtout du vide entre des commandes qui n’avaient rien à voir les unes avec les autres.

```bf-figure
{
  "kind": "screen",
  "frame": "Avant — le tableau obtient ce qui reste",
  "ratio": 1.6,
  "regions": [
    { "label": "Barre de session", "note": "Titre · sélecteur · sept boutons · participants · enregistrer", "x": 2, "y": 3, "w": 96, "h": 11, "hue": "bad" },
    { "label": "Commandes de surface", "x": 2, "y": 16, "w": 96, "h": 9, "hue": "bad" },
    { "label": "Le tableau", "x": 2, "y": 27, "w": 96, "h": 46, "hue": "muted" },
    { "label": "Barre d’équipe — toujours active", "x": 2, "y": 75, "w": 96, "h": 9, "hue": "bad" },
    { "label": "Dock en direct · coin mentions légales", "x": 2, "y": 86, "w": 96, "h": 11, "hue": "bad" }
  ],
  "caption": "Quatre bandes, retranchées de chaque canevas sur chaque page — y compris le dock en direct, qui réservait une bande de la fenêtre pour un appel que presque personne n’était sur le point de lancer."
}
```

```bf-figure
{
  "kind": "screen",
  "frame": "Après — le tableau remplit la fenêtre, tout flotte",
  "ratio": 1.6,
  "regions": [
    { "label": "Le tableau", "note": "D’un bord à l’autre, passant derrière l’interface plutôt que commençant en dessous", "x": 2, "y": 3, "w": 96, "h": 94, "hue": "make" },
    { "label": "Ce que ce canevas EST", "x": 5, "y": 7, "w": 30, "h": 10, "hue": "idea" },
    { "label": "Comment il est LU", "x": 38, "y": 7, "w": 26, "h": 10, "hue": "accent" },
    { "label": "Comment le travail en SORT", "x": 67, "y": 7, "w": 28, "h": 10, "hue": "reach" },
    { "label": "Ce que vous lui FAITES", "x": 20, "y": 84, "w": 60, "h": 10, "hue": "accent" }
  ],
  "caption": "La carte dans laquelle atterrit une commande est une DONNÉE, pas un jugement dans un composant : une seule table déclare les quatre emplacements, et une commande ne peut pas être ajoutée à l’un sans que le test remarque qu’elle manque dans l’autre."
}
```

## La règle qui a rendu le repli sûr

Un canevas remplit l’écran et sa barre ne change pas pendant plusieurs minutes d’affilée : la replier vaut donc la peine. Ce qui rend cela dangereux, c’est la moitié de la barre qui **rapporte** plutôt qu’elle n’agit.

Repliez « qui est dans cette session », « la connexion est-elle active » et « une exécution est-elle en cours », et l’opérateur travaille à l’aveugle sur un tableau que d’autres modifient.

```bf-figure
{
  "kind": "compare",
  "title": "Le repli masque les commandes, jamais l’état",
  "columns": [
    { "title": "Survit à un repli — l’état", "hue": "good", "items": ["Le titre — sur quel canevas vous êtes", "L’état d’enregistrement — le FAIT qu’il soit enregistré ou non", "La liste des participants — qui est ici", "L’état de la surface — cette chose est-elle active"] },
    { "title": "Se replie — les commandes", "hue": "muted", "items": ["Le sélecteur de surface", "Le groupe d’actions", "Les commandes propres à la surface", "Le BOUTON d’enregistrement — appuyer dessus ouvre la barrière de compte"] }
  ],
  "caption": "L’enregistrement est le cas intéressant : il se lit comme un état et se comporte comme une commande, de sorte que le bouton se replie et que l’état à côté reste. Ce sur quoi l’on peut appuyer est une commande, aussi factuel que paraisse son libellé."
}
```

Elle est écrite sous forme de table plutôt que de condition, car « les actions » n’est pas la frontière : le sélecteur de surface est une commande et l’indicateur de temps réel n’en est pas une, et ils sont à deux éléments de distance sur la même ligne. Une règle que les relecteurs doivent se rappeler est une règle qui dure environ trois pull requests.

## Une barre par canevas, pas une par environnement d’exécution

Ajouter une façon d’*exécuter* une application sur le tableau a immédiatement produit ce que tout éditeur visuel cherche à éviter : deux barres d’outils, de même hauteur, de même style, en désaccord sur celle sur laquelle on appuie.

Désormais, la surface apporte ses commandes **dans** la barre unique. Une surface ajoutée l’an prochain y obtient une place gratuitement, et une action déclare ce dont elle a *besoin* — des objets, un tableau — plutôt que de lister les surfaces auxquelles elle s’applique. L’alternative serait que chaque future surface soit ajoutée à chaque liste qui se trouve s’appliquer à elle, dans un fichier que personne n’ouvre pour cette raison.

## Et un téléphone ne pouvait pas du tout partager un canevas

C’est la partie qui mérite d’être généralisée.

Une règle mobile générale masquait chaque bouton sans libellé de la barre. La feuille de débordement qui y survivait n’en listait aucun. Un téléphone perdait donc silencieusement l’annulation, le rétablissement, les diagnostics, la fiche de résultats **et toute voie d’accès au panneau d’invitation** : cinq actions, dont aucune n’était déclarée manquante nulle part. Cela venait d’une seule ligne de CSS indexée sur un nom de classe.

Le placement est désormais une donnée : chaque action déclare si un téléphone l’affiche dans la barre ou dans le débordement, et les deux sont rendus à partir de cette même liste, de sorte que la barre et le menu sont complémentaires. Une action ne peut pas se retrouver dans aucun des deux, et un test l’affirme — y compris le budget de deux actions pour la barre du téléphone, car au-delà de deux, ce qui se trouve écrasé est le titre, qui est la seule chose qui vous dit sur quel canevas vous êtes.

---

**À lire aussi :** [Exécutez l’application que votre tableau vient de construire](/blog/run-your-app-on-the-canvas) · [Le Creation Canvas n’est pas une fenêtre de discussion](/blog/creation-canvas-beyond-chat) · [Creation Canvas multijoueur, web et VS Code](/blog/multiplayer-creation-canvas-web-vscode)

[Ouvrez un canevas](/create) — il est désormais identique sur un téléphone, ce qui n’était pas le cas.
