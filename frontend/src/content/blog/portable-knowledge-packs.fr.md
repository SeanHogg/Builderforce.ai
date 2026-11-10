Une revue de connaissances produit quelque chose de durement acquis : un graphe de ce que signifie réellement une base de code — ses systèmes, ses faits, ses relations et les arbitrages qui les sous-tendent. Jusqu'ici, cette compréhension vivait à un seul endroit et ne servait qu'un seul outil. Revoir le même dossier dans un second hôte revenait à tout repayer, et deux hôtes pouvaient ne pas être d'accord.

Voilà le manque que cela comble : **la compréhension prouvée par votre revue restait prisonnière de l'hôte qui l'avait exécutée.** Désormais, elle se met en paquet et voyage.

## Un paquet portable, pas une pile de fichiers

L'unité, c'est le paquet de connaissances portable — un `.bfpack` sur disque. Il transporte les faits revus, les constats et les arbitrages, et il est agnostique vis-à-vis du modèle par conception : aucun embedding n'y est intégré, chaque consommateur recalcule donc les vecteurs à partir du texte des fiches, par hachage. Ce qui rend un paquet digne de confiance l'accompagne sous forme de provenance : qui l'a revu, avec quel modèle juge, selon quelle politique, et quand.

```bf-figure
{
  "kind": "flow",
  "title": "Une revue en entrée, un paquet en sortie",
  "steps": [
    { "label": "Revoir un dossier", "note": "La revue construit un graphe de systèmes, de faits et de relations, avec les arbitrages consignés.", "hue": "make" },
    { "label": "Créer le paquet", "note": "Une commande transforme le graphe revu en .bfpack portable, provenance comprise.", "hue": "run" },
    { "label": "Tout agent y puise", "note": "L'unique jonction PackRegistry → récupération sert le chat, Synapse, le web et le tour Evermind du Canvas.", "hue": "measure" }
  ],
  "caption": "Une revue, un paquet, tous les consommateurs — sans second chemin de récupération."
}
```

## Une jonction, tous les consommateurs

Il existe exactement une manière d'interroger un paquet : la jonction `PackRegistry` → `PackRetrievalPort`. Le chat de VS Code, le paquet de contexte, Synapse, `knowledge.ask` sur le web et le tour Evermind du Canvas passent tous par elle. Un nouveau consommateur ajoute une implémentation du registre — jamais une seconde fusion ni un second chemin de récupération —, si bien que « quelles connaissances le modèle a-t-il vues » a toujours une seule réponse.

Téléversez un paquet dans un projet et il y devient une racine de connaissances : ses faits rejoignent ceux du projet et alimentent son Evermind, et le retirer ne retire que ce qu'il avait apporté.

## Pourquoi c'est important

- **Payer une fois, utiliser partout.** Ce qui coûte cher, c'est la revue. Mettre en paquet signifie la payer une seule fois, et la compréhension sert chaque hôte et chaque modèle.
- **La confiance est transportée, pas affirmée.** La provenance est consignée à la création du paquet et affichée au moment du choix — « Revu par … avec … » —, de sorte que la crédibilité d'un paquet est un fait, pas une promesse.
- **Une seule réponse à ce que savait le modèle.** Une jonction de récupération unique rend reproductible le contexte derrière une réponse.

## Sa place dans la méthode

C'est **Make** qui se capitalise en **Measure** : la revue est l'investissement, le paquet est le rendement, et la récupération est la manière dont le reste de la plateforme le dépense.

## Ce que vous pouvez en faire dès aujourd'hui

Revoyez un dossier, créez un paquet, et voyez les mêmes connaissances revues répondre dans le chat, dans Synapse et sur le Canvas. Téléversez un paquet dans un projet et voyez ses faits rejoindre l'Evermind du projet.
