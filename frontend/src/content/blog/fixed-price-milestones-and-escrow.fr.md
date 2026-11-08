# Des jalons à prix fixe, avec l’argent conservé jusqu’à la livraison

Le travail à prix fixe échoue dans deux directions, et tous ceux qui ont été d’un côté ou de l’autre connaissent les deux.

Le client paie d’avance et le travail dérive. Ou le prestataire livre et la facture vieillit en une discussion pour savoir si c’était vraiment terminé. La facturation horaire existe en partie pour contourner cela, et elle le résout en ne rendant personne responsable d’un résultat.

Le séquestre est l’ancienne réponse : de l’argent engagé, conservé, puis libéré contre des livrables convenus. Cela fonctionne, et cela échoue généralement sur le logiciel plutôt que sur l’idée, car les deux parties regardent des écrans différents qui ne s’accordent pas sur ce qui s’est passé.

## Un seul calendrier, trois surfaces, aucune seconde copie

```bf-figure
{
  "kind": "flow",
  "title": "La vie d’un jalon",
  "steps": [
    { "label": "Financer", "note": "Le client engage le montant. Tant que cela n’est pas fait, le jalon ne peut pas démarrer : c’est tout l’intérêt de l’arrangement.", "hue": "reach", "tag": "client" },
    { "label": "Livrer", "note": "Le prestataire le marque comme livré avec ce qu’était le livrable.", "hue": "make", "tag": "prestataire" },
    { "label": "Accepter ou demander", "note": "Le client accepte, ou demande des modifications en indiquant un motif. Les deux sont consignés ; aucun n’est un silence.", "hue": "run", "tag": "client" },
    { "label": "Libérer", "note": "Le montant conservé est transféré. Le solde, les cinq totaux consolidés et l’historique proviennent tous de la même lecture.", "hue": "measure" }
  ],
  "caption": "L’annulation est elle aussi une étape à part entière, et elle se comporte différemment avant et après le financement, car ce sont des situations réellement différentes, pas une même situation avec un indicateur."
}
```

Le panneau qu’un client voit dans son mandat, celui qu’un employeur voit sur une offre et l’onglet jalons du prestataire sont **un seul composant**. Pas trois implémentations d’un design partagé : une seule, affichée à trois endroits.

Ce n’est pas du rangement pour le rangement. C’est ce qui empêche le bug classique du séquestre, où l’écran du client propose *Libérer* alors que le serveur a déjà fait passer le jalon dans un état où la libération est refusée, et que la personne qui clique reçoit une erreur qui ressemble à une panne du système et se vit comme une escroquerie.

## Les boutons sont la décision du serveur

C’est la décision de conception qui mérite d’être reprise, quoi que vous construisiez.

Chaque ligne de jalon arrive du serveur avec la liste des **actions disponibles pour cette partie dans cet état**. Le panneau affiche les gestes qu’on lui a remis. Il ne peut pas en proposer un qui serait refusé, car il ne sait pas en calculer un.

```bf-figure
{
  "kind": "compare",
  "title": "Deux manières de décider ce qu’un bouton propose",
  "columns": [
    { "title": "Le navigateur le calcule", "hue": "bad", "items": ["La règle vit à deux endroits", "Une troisième copie apparaît dans l’application mobile", "Elles divergent au premier cas limite", "L’utilisateur rencontre la divergence sous forme d’erreur"] },
    { "title": "Le serveur le projette", "hue": "good", "items": ["Une machine décide, une machine juge", "Un nouvel état est un changement serveur sans modification de l’interface", "Le panneau ne peut pas proposer un geste impossible", "Toutes les surfaces s’accordent par construction"] }
  ],
  "caption": "Pour la même raison qu’un composant partagé décide lui-même de sa visibilité plutôt que de recevoir une propriété `canRelease` de la part de celui qui l’a affiché."
}
```

## Une offre peut proposer son propre calendrier

Un prix fixe sans forme n’est qu’un chiffre sur lequel discuter. Une offre peut désormais porter le calendrier qu’elle propose — les jalons, ce que chacun livre, ce que chacun vaut — de sorte que la négociation porte sur le plan plutôt que sur le total. Accepter l’offre revient à accepter le calendrier avec elle.

Cela améliore aussi la première conversation. « 12 000 £ » invite à marchander. « 12 000 £, en quatre parties, dont la première est un import fonctionnel que vous pouvez exécuter sur vos propres données dès la deuxième semaine » invite à décider.

## Sa place

Le Marché — vendre, acheter, recruter, être trouvé — est l’étape qui suit le moment où la chose fonctionne. Le séquestre est l’un des mécanismes qui fait fonctionner l’achat entre des parties qui n’ont encore aucune raison de se faire confiance, ce qui est la condition normale d’une place de marché. Il se tient à côté du [vocabulaire commercial](/blog/close-the-deal-on-the-board-you-built-it-on) sur le tableau et des [factures et recouvrements](/blog/the-founder-back-office-money-ownership-and-paperwork) dans le back-office : le même argent, à trois distances différentes du travail.

---

**À lire aussi :** [Concluez l’affaire sur le tableau où vous l’avez construite](/blog/close-the-deal-on-the-board-you-built-it-on) · [Recruter, affecter et payer le travail au même endroit](/blog/hire-assign-and-pay-for-work-in-one-place) · [Le back-office du fondateur](/blog/the-founder-back-office-money-ownership-and-paperwork)

Parcourez la [place de marché des freelances](/freelancer) ou [ouvrez un canevas](/create) et cadrez d’abord le travail.
