# Le back-office du fondateur — l’argent qui entre, la propriété, et la paperasse avant toute l’autre paperasse

Trois choses dont une entreprise a besoin dès sa première année, dont aucune n’est le produit : se faire payer, savoir qui possède quoi, et disposer des documents qui donnent un sens aux deux premières.

Ce sont généralement trois outils, trois exports et un tableur auquel tout le monde a cessé de faire confiance. Voici ce qui a changé quand elles sont devenues des objets sur le même tableau que le travail.

## 1 · L’argent qui entre

Le poste de la finance était à sens unique par construction. L’argent pouvait sortir — versements, factures fournisseurs, paie — et rien ne pouvait en faire entrer. Les actions de facturation étaient annoncées, soumises à barrière, approuvées… et n’avaient rien derrière elles.

```bf-figure
{
  "kind": "flow",
  "title": "Une facture, de bout en bout",
  "steps": [
    { "label": "Émettre", "note": "Sur un vrai compte client, et non un nom rapproché par l’orthographe.", "hue": "run" },
    { "label": "Vieillir", "note": "Jours de retard calculés à partir de l’échéance. Jamais saisis, car un vieillissement périmé est pire que pas de vieillissement.", "hue": "run", "tag": "calculé" },
    { "label": "Relancer", "note": "Un échelon d’une échelle de recouvrement, consigné une fois par étape : le même client n’est donc jamais relancé deux fois pour la même chose.", "hue": "reach" },
    { "label": "Enregistrer le paiement", "note": "Ce qui est réellement arrivé, par rapport à ce qui était dû.", "hue": "measure" }
  ],
  "caption": "Un travail de recouvrement sans trace est un travail de recouvrement fait deux fois ou pas du tout. L’échelle est unique par facture et par étape pour exactement cette raison."
}
```

Le changement de contrepartie en dessous est le plus discret. `invoice.customer`, `bill.vendor`, `contract.counterparty` et `placement.client` étaient tous du texte libre avec la consigne de « le rapprocher d’une entreprise du tableau par son nom ». Trois consignes quasi identiques, trois occasions pour un « Ltd » final de produire un second Acme. Ils se résolvent désormais par une même recherche de compte partagée : une jointure en direct, et non un identifiant copié : renommer un compte ne laisse donc pas quatre copies périmées de son ancien nom éparpillées dans vos factures.

## 2 · Un tableau de capitalisation qui survit à son deuxième événement

Voici la forme que prend presque tout tableur de fondateur, et pourquoi il finit toujours par casser.

```bf-figure
{
  "kind": "compare",
  "title": "Deux façons d’enregistrer la propriété",
  "columns": [
    { "title": "Un tableau de détenteurs", "hue": "bad", "items": ["Détenteur, instrument, actions, pourcentage", "Chaque événement oblige à RESAISIR tout le tableau", "Un abondement du pool le casse", "Un départ le casse", "Un rachat le casse", "Des pourcentages qui ne totalisent pas 100, avec une note qui explique pourquoi"] },
    { "title": "Autorisé, attribué et événements", "hue": "good", "items": ["Classes d’actions = ce que le conseil a autorisé", "Attributions = les CONDITIONS d’une attribution", "SAFE et billets comme instruments distincts : un seul d’entre eux accumule des intérêts", "Un historique en ajout seul des émissions, cessions, exercices, annulations", "Les pourcentages sont de l’arithmétique sur cet historique"] }
  ],
  "caption": "Le pool d’options est une CLASSE, pas un indicateur : « ce qui n’est pas alloué » est l’autorisé moins l’attribué DANS cette classe, ce qu’un booléen ne peut pas exprimer."
}
```

Un tour de financement est un enregistrement de ce qui est *négocié* : l’instrument, le montant recherché, la valorisation demandée, le chef de file, la date de clôture visée. Ce qui a réellement été clôturé est dérivé des allocations : l’en-tête du tour et l’argent qu’il contient ne peuvent donc jamais se contredire. Une colonne « montant levé » stockée serait un total que les lignes en dessous peuvent contredire, et le jour où elles le font, personne ne sait laquelle est vraie.

## 3 · La paperasse avant l’autre paperasse

Deux fondateurs peuvent se trouver, s’entendre, se serrer la main — et n’avoir nulle part où le consigner. Les documents fondateurs sont donc des modèles, remplis et envoyés pour signature :

- **Pacte des fondateurs**
- **Cession de propriété intellectuelle des fondateurs**
- **Calendrier d’acquisition (vesting) des fondateurs**
- **Accord de confidentialité mutuel**

Un champ obligatoire manquant est refusé *par son nom*, avec la liste de ce qui manque. Cela semble pointilleux jusqu’à ce que l’on considère l’alternative : afficher un tiret cadratin dans un pacte de fondateurs et laisser quelqu’un le signer. Une erreur est rattrapable ; un document signé avec un blanc dans la clause de propriété ne l’est pas.

Au-delà de ces quatre, tout document juridique peut être conservé chiffré, partagé par lien et signé, avec le texte figé exactement tel qu’il était à la signature. Et une salle de données peut contenir les fichiers réels qu’une demande de due diligence réclame, et non seulement la liste de contrôle qui les nomme — ce qui était l’état des choses il y a peu, et l’écart le plus discrètement gênant de cette liste.

## Pourquoi cela se trouve sur le même tableau que le produit

Parce que l’alternative est ce que tout le monde fait : un outil financier qui ne sait pas ce que vous construisez, un outil de tableau de capitalisation qui ne sait pas qui y travaille, et un outil de signature qui ne le sait pas non plus.

```bf-figure
{
  "kind": "stack",
  "title": "Un seul tableau, quatre distances du travail",
  "bands": [
    { "label": "Le travail", "note": "Cartes, code, tickets, la chose en cours de construction.", "hue": "make" },
    { "label": "L’affaire", "note": "Devis, essais, plans d’action mutuels : ce qui est vendu, relié à ce qu’il vend.", "hue": "reach" },
    { "label": "L’argent", "note": "Factures, factures fournisseurs, recouvrement, cycles de paie : calculés à partir des lignes, non saisis sur une carte.", "hue": "run" },
    { "label": "L’entreprise", "note": "Propriété, instruments, les documents fondateurs dont tout le reste suppose l’existence.", "hue": "measure" }
  ],
  "caption": "Exécuter est une étape entière de l’arc — « l’exploiter comme une entreprise » — et c’est l’étape pour laquelle la plupart des outils de construction vous renvoient vers un tableur."
}
```

---

**À lire aussi :** [Concluez l’affaire sur le tableau où vous l’avez construite](/blog/close-the-deal-on-the-board-you-built-it-on) · [Jalons à prix fixe et séquestre](/blog/fixed-price-milestones-and-escrow) · [De l’idée au réel — la méthodologie opérationnelle](/blog/idea-to-real-the-operating-methodology)

[Ouvrez un canevas](/create) et placez la facture à côté du travail auquel elle correspond.
