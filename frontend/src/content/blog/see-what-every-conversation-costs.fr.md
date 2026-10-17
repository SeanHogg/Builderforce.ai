« Builderforce se souvient, donc il dépense moins. » Nous le répétons depuis des mois. Jusqu'à aujourd'hui, il fallait nous croire sur parole.

La couche mémoire faisait son travail. Elle répondait de mémoire aux questions répétées et gardait les longues conversations dans un contexte allégé. Le cache de prompts du fournisseur servait l'essentiel d'un long prompt pour un dixième du prix. Rien de tout cela n'apparaissait à un endroit où vous pouviez le voir. Une question répondue de mémoire laissait sur la chronologie une note indiquant que le modèle avait été court-circuité, sans rien dire de ce que cela valait. Un tour passé sur votre propre clé Claude était enregistré comme gratuit, parce que Builderforce n'avait rien payé. Vous, si.

La question « combien ça coûte, et la mémoire aide-t-elle vraiment ? » n'avait donc aucune réponse sur l'écran où vous travailliez. Désormais, elle en a une.

## Le chiffre au-dessus de chaque chat

Le bandeau au-dessus de chaque conversation affiche maintenant ce qu'elle a coûté et ce que la mémoire lui a fait économiser, à côté de l'état de ses tickets.

```bf-figure
{
  "kind": "screen",
  "frame": "Le bandeau au-dessus d'une conversation",
  "ratio": 3.2,
  "regions": [
    { "label": "État des tickets", "note": "104 tickets · 83 %", "x": 2, "y": 12, "w": 46, "h": 76, "hue": "make" },
    { "label": "$0.42 · 1.2M tok · ≈$0.31 économisés", "note": "Cliquez pour le détail", "x": 52, "y": 12, "w": 46, "h": 76, "hue": "measure" }
  ],
  "caption": "Le chiffre arrive avec le chat que la page charge déjà. Il n'a besoin ni de sa propre requête ni d'interrogation périodique."
}
```

Cliquez sur le chiffre pour voir où est passé l'argent :

- **Dépensé** comporte deux lignes. **Forfait Builderforce**, c'est ce qui a été facturé sur votre forfait. **Votre clé**, c'est ce que vos propres comptes fournisseurs factureraient, au prix catalogue. Un tour passé sur votre compte Claude ou OpenAI connecté n'est pas gratuit simplement parce que nous ne l'avons pas payé.
- **Économisé grâce à la mémoire** est détaillé par source, et chaque source est soit *mesurée*, soit une *estimation*.

## Ce qui compte comme économie, et avec quelle certitude

Seule une partie des économies peut être mesurée. Nous affichons les deux types séparément et n'ajoutons jamais une estimation à un chiffre mesuré.

```bf-figure
{
  "kind": "compare",
  "title": "Chiffres mesurés et estimations",
  "columns": [
    {
      "title": "Mesuré",
      "hue": "measure",
      "items": [
        "Répondu de mémoire. Quand un modèle a répondu à la question la première fois, nous avons enregistré son nombre de tokens avec la réponse. Une question répétée économise exactement ce tour.",
        "Requête répétée. La passerelle a rejoué une requête identique, et la réponse enregistrée porte encore la consommation de l'appel d'origine.",
        "Cache de prompts. Votre fournisseur indique combien de tokens du prompt il a servis depuis le cache, pour environ un dixième du prix."
      ]
    },
    {
      "title": "Estimé (signalé par ≈)",
      "hue": "idea",
      "items": [
        "Répondu par Evermind. Aucun modèle payant n'a produit cette réponse, nous comptons donc la question et la réponse à environ quatre caractères par token.",
        "Contexte allégé. La compaction a tenu les anciens tours à l'écart de chaque appel.",
        "Souvenirs ajoutés. Le côté coût : ce que les souvenirs rappelés ont ajouté à chaque prompt. C'est déduit de l'estimation."
      ]
    }
  ],
  "caption": "Les estimations restent prudentes. Un vrai tour de modèle envoie aussi le prompt système, l'historique et les définitions d'outils, et rien de tout cela n'est compté."
}
```

Ce dernier point compte. Se souvenir coûte aussi des tokens, car les souvenirs rappelés sont ajoutés au prompt. Nous déduisons ce coût : l'économie affichée est donc nette. Si, sur une conversation, la mémoire ne rapporte pas plus qu'elle ne coûte, le chiffre le dit.

## Le panneau de travail, le même partout

Le panneau `/` de la zone de saisie est le même sur chaque surface : le Brain sur le web, le canvas, le panneau VS Code et Rovr dans Chrome. Il a les mêmes quatre onglets : Mode, Effort, Modèle et Statut.

```bf-figure
{
  "kind": "devices",
  "title": "Une zone de saisie, quatre endroits",
  "devices": [
    { "label": "Brain sur le web", "width": 1280, "height": 800, "note": "Mode · Effort · Modèle · Statut", "hue": "make" },
    { "label": "Canvas", "width": 1024, "height": 720, "note": "Même panneau, même onglet Statut", "hue": "make" },
    { "label": "Panneau VS Code", "width": 320, "height": 720, "note": "Même panneau dans une barre latérale étroite", "hue": "run" },
    { "label": "Panneau latéral Rovr", "width": 360, "height": 720, "note": "Même panneau dans Chrome", "hue": "run" }
  ],
  "caption": "Un seul composant partagé. Un réglage ne peut pas exister à un endroit et manquer à un autre."
}
```

**Statut** affiche maintenant les dépenses et économies d'IA de votre espace de travail sur les 30 derniers jours, à côté du forfait et de ses compteurs. Il indique aussi clairement quand toutes les limites sont levées parce que vous êtes opérateur superadmin, au lieu d'afficher « Free » à côté d'une colonne d'« Illimité ». L'Evermind du projet apparaît sous la forme des deux faits distincts qu'il recouvre réellement : s'il **apprend** des chats de ce projet, et s'il est autorisé à **répondre** à la place d'un modèle payant.

**Mémoire**, dans l'onglet Mode, est désormais un réglage de la conversation elle-même. Désactivez-la dans l'éditeur, et elle l'est aussi sur le web. Désactivée signifie également que les outils de rappel et de mémorisation de l'agent lui-même sont coupés, et pas seulement le rappel effectué avant chaque réponse.

## Sa place dans la méthode

De l'Idée au Réel se conclut par **Mesurer** : chaque preuve a un chiffre capable d'arrêter le projet, et ce chiffre est vérifié dès que le travail tourne. Le coût est l'un de ces chiffres, et la mémoire est censée le faire baisser. Une économie que personne ne voit ne peut pas être vérifiée. Impossible de décider s'il faut laisser la mémoire activée sur une conversation, connecter votre propre clé ou choisir le niveau d'effort d'une tâche sans savoir ce que coûte chaque option.

Ce chiffre se trouve désormais là où la décision se prend : sur la conversation, pendant que vous travaillez, avec les chiffres mesurés et les estimations tenus à part, pour que la vérification soit honnête.

Et cela ne coûte rien de plus à faire tourner. Les économies sont écrites dans les mêmes enregistrements d'usage que la plateforme tient déjà. Les chiffres arrivent avec des données que chaque surface charge déjà. Ajouter le compteur n'a pas ajouté une seule requête.
