# Chaque compte obtient un programme commercial

Vous pouvez porter une idée sur un canevas, la transformer en objets à force de discussion, construire la chose, l’exploiter comme une entreprise et lire si cela a fonctionné. Ensuite, il faut que quelqu’un l’achète.

Jusqu’à cette semaine, le rail de gauche n’apportait une réponse honnête à cela que pour un seul type de compte. **Sales Hub** — pipeline, campagnes, objectifs hebdomadaires, rapports, versements, kit commercial — était une ligne que l’on ne voyait que si l’on s’était inscrit comme associé commercial de Builderforce. Tous les autres, y compris chaque fondateur qui venait de livrer quelque chose sur la plateforme, avaient un rail qui allait *Idée · Réaliser · Exécuter · Mesurer* puis leur remettait une fiche de place de marché en leur souhaitant bonne chance.

Ce n’est pas une fonctionnalité manquante. C’est une fonctionnalité construite derrière la mauvaise porte.

## Ce qui la verrouillait réellement

Une seule ligne. Le service qui répond à *à qui appartient cet espace de travail commercial* exigeait un type de compte avant de remettre à quelqu’un le sien :

```
if (requested === current.id) return current.accountType === 'sales' ? { … } : null;
```

Chaque ligne que le hub touche — contacts, campagnes, objectifs, parrainages, règles de commission — est déjà indexée par `ownerUserId`. Rien n’a jamais été partagé entre comptes. Le contrôle ne protégeait les données de personne ; il décidait qui avait le droit d’avoir son propre pipeline. L’ouvrir revenait donc à retirer une barrière, non à élargir un périmètre, et la lecture inter-comptes est restée exactement aussi étroite qu’avant : un superadmin ne peut toujours ouvrir que l’espace de travail d’un associé de la plateforme, jamais le pipeline privé d’un client.

```bf-figure
{
  "kind": "compare",
  "title": "Le même hub, deux populations",
  "columns": [
    { "title": "Avant", "hue": "muted", "items": [
      "Des associés commerciaux qui vendent Builderforce lui-même",
      "Un superadmin qui lit les chiffres d’un associé",
      "Tous les autres : pas de ligne, pas de pipeline, pas de lien de parrainage"
    ] },
    { "title": "Maintenant", "hue": "reach", "items": [
      "Chaque compte, sur son propre espace de travail",
      "Un superadmin qui lit les chiffres d’un associé — inchangé",
      "Un hub, une définition du taux de conversion, un rapport"
    ] }
  ],
  "caption": "Un second hub pour les fondateurs aurait été une seconde définition de « gagné » en attente de contredire la première."
}
```

## Ce que vous obtenez à la première ouverture

Six sous-vues, toutes déjà indispensables puisque les associés y font tourner leur activité :

```bf-figure
{
  "kind": "stack",
  "title": "Sales Hub",
  "bands": [
    { "label": "Vue d’ensemble", "note": "Les objectifs hebdomadaires face à ce qui s’est réellement passé : prospection, contacts, rendez-vous.", "hue": "reach" },
    { "label": "Prospects", "note": "Le pipeline. Sept étapes, une valeur de contrat, une probabilité, une date de clôture prévue.", "hue": "reach" },
    { "label": "Rapports", "note": "Inscriptions, conversions, chiffre d’affaires converti, commission gagnée : un seul rapport, quel que soit le lecteur.", "hue": "measure" },
    { "label": "Versements", "note": "Gagné dans le domaine commercial, payé depuis le registre, le disponible est l’arithmétique entre les deux.", "hue": "run" },
    { "label": "Boîte de réception", "note": "La messagerie connectée, à côté du pipeline qu’elle alimente.", "hue": "reach" },
    { "label": "Kit", "note": "Les supports, et le lien de parrainage qui vous attribue une inscription.", "hue": "reach" }
  ],
  "caption": "Rien ici n’est du code nouveau. C’est le même hub qui faisait tourner le programme d’associés de Builderforce, désormais détenu par la personne qui le regarde."
}
```

Les *objets* commerciaux — devis qui peuvent être acceptés, séquences qui s’arrêtent à une réponse, essais avec des critères convenus d’avance, plans d’action mutuels — vivent sur le canevas depuis août, et c’est toujours le cas. C’est l’autre moitié du même argument : le canevas est l’endroit où l’on travaille une affaire précise, et le hub est l’endroit où l’on lit la forme de toutes les affaires à la fois.

## Sa place dans la méthode

La portée. Et la Portée est désormais plus courte d’une étape à énoncer.

```bf-figure
{
  "kind": "screen",
  "frame": "Le rail de gauche",
  "ratio": 1.05,
  "regions": [
    { "label": "Idée", "note": "Canevas", "x": 4, "y": 8, "w": 92, "h": 12, "hue": "idea" },
    { "label": "Réaliser", "note": "Projets, main-d’œuvre, qualité, fiabilité, connaissances", "x": 4, "y": 22, "w": 92, "h": 12, "hue": "make" },
    { "label": "Exécuter", "note": "Les neuf postes d’activité", "x": 4, "y": 36, "w": 92, "h": 12, "hue": "run" },
    { "label": "Mesurer", "note": "Analyses", "x": 4, "y": 50, "w": 92, "h": 12, "hue": "measure" },
    { "label": "Portée", "note": "Place de marché · Développeurs · Sales Hub", "x": 4, "y": 64, "w": 92, "h": 16, "hue": "reach" },
    { "label": "Étendre", "note": "Supprimé — un titre au-dessus d’une seule ligne", "x": 4, "y": 82, "w": 92, "h": 10, "hue": "muted", "style": "ghost" }
  ],
  "caption": "Un titre avec un seul lien en dessous est une étiquette, pas une architecture de l’information."
}
```

Le rail comportait auparavant une sixième étape productive appelée **Étendre**, dont tout le contenu était le programme commercial. La distinction qu’elle faisait était assez réelle sur le papier — la *Portée* consiste à mettre la chose devant les gens, *Étendre* à faire croître l’entreprise dans son sillage — et elle coûtait à chacun un mot de plus à lire avant de pouvoir trouver quoi que ce soit.

C’est aussi une distinction qui cesse d’être vraie dès qu’un fondateur, et non un associé, se tient devant. Vendre ce que l’on a fait et être trouvé pour cela sont le même acte à des volumes différents. La Portée l’a donc absorbée, la question de l’arc s’est un peu allongée — *le vendre, être trouvé, le faire croître* — et toute la méthode tient de nouveau en cinq mots, soit le nombre qu’une personne peut répéter après avoir lu le rail une seule fois.

C’est le test auquel cette navigation a toujours été soumise. Le menu est la méthodologie ; si vous ne pouvez pas énoncer la méthodologie, le menu a cessé de fonctionner.

## L’argument du « dogfooding », énoncé simplement

Builderforce vend un programme commercial à ses propres associés. Ce serait un étrange produit que celui qui en vendrait un sans en donner un à ceux qui construisent des entreprises dessus — et plus étrange encore celui qui livrerait un CRM, ferait passer son propre chiffre d’affaires dedans pendant des mois, puis demanderait à ses clients d’aller en acheter un autre.

Chaque capacité de cette plateforme est une capacité dont le fondateur qui l’utilise aura un jour besoin. Celle-ci, il en a besoin le jour où ce qu’il a construit fonctionne.
