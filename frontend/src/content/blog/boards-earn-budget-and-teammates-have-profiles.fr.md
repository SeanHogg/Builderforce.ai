Un tableau pouvait clore cent tickets en un mois sans que rien, nulle part, ne le dise. Le travail était réel, les tickets étaient Terminés, et le chiffre qui répond à « qu’a gagné ce tableau ? » n’existait pas. Les investisseurs avaient le même problème, vu de l’autre côté : la mise à jour qu’ils lisaient décrivait l’entreprise en phrases, tandis que la livraison qui les justifiait restait sur un tableau qu’ils n’ouvriraient jamais.

Deux manques, une seule racine. La livraison était un fait sur un ticket et ne devenait jamais un fait sur le tableau, ni sur l’entreprise.

## Un tableau gagne du budget quand ses tickets passent à Terminé

Chaque ticket qui entre dans une colonne Terminé fait désormais gagner du budget à son tableau, en points : les points d’histoire du ticket, ou un point si personne ne l’a estimé. Cela se produit à l’unique endroit par lequel passe tout déplacement de colonne ; faire glisser une carte, un agent qui termine une exécution et une pull request fusionnée paient donc de la même façon, et un ticket rouvert puis refermé ne paie qu’une fois.

```bf-figure
{
  "kind": "flow",
  "title": "D’un ticket clos à un chiffre qu’un tableau peut afficher",
  "steps": [
    {
      "label": "Le ticket passe à Terminé",
      "note": "Par n’importe quel chemin : un glisser-déposer, une exécution d’agent, une pull request fusionnée.",
      "hue": "make"
    },
    {
      "label": "Le tableau gagne des points",
      "note": "Ses points d’histoire, ou un. Enregistré une fois par ticket, donc une réouverture ne paie jamais deux fois.",
      "hue": "run"
    },
    {
      "label": "Jalon atteint",
      "note": "Une épopée se termine ou une version sort, et les gains du tableau pour elle sont totalisés.",
      "hue": "measure",
      "tag": "vers le canal investisseurs"
    }
  ],
  "caption": "Le gain passe par le même registre que tous les autres soldes du produit. Aucune seconde table ne peut s’écarter du travail qu’elle décrit."
}
```

La dépense se lit à côté, pas à l’intérieur. Ce que coûtent les exécutions d’un tableau est déjà enregistré par ticket ; le panneau lit donc ce chiffre au lieu d’écrire une seconde copie qui pourrait contredire la première.

```bf-figure
{
  "kind": "screen",
  "frame": "Un tableau avec son budget ouvert",
  "ratio": 1.62,
  "regions": [
    {
      "label": "Le tableau",
      "note": "Colonnes et tickets, exactement comme avant",
      "x": 4,
      "y": 8,
      "w": 56,
      "h": 74,
      "hue": "make"
    },
    {
      "label": "Budget gagné",
      "note": "Points gagnés, coût des exécutions, jalons atteints, gains récents",
      "x": 63,
      "y": 8,
      "w": 33,
      "h": 74,
      "hue": "run"
    },
    {
      "label": "Barre du tableau",
      "note": "Un nouveau bouton, à côté de configurer",
      "x": 4,
      "y": 88,
      "w": 92,
      "h": 8,
      "hue": "accent"
    }
  ],
  "caption": "Le budget s’ouvre dans un panneau latéral au-dessus du tableau ; les colonnes restent visibles pendant la lecture."
}
```

## Des jalons qui atteignent les investisseurs

Un jalon est quelque chose qui est arrivé à un tableau : une épopée terminée, ou une version rattachée à son projet qui est sortie. Chacun porte désormais les points gagnés par ses tickets, et une seule lecture liste tous les jalons atteints depuis une date, par tableau. La mise à jour investisseurs compose sa section livraison à partir de là. Elle ne dit plus « nous avons livré » sans un tableau et un chiffre derrière.

## Vos collègues ont une page, et les mentions savent à qui elles parlent

Le second manque était plus petit et plus humain. La personnalité d’un collègue apparaissait dans une infobulle sur le tableau, nulle part où l’on puisse faire un lien. Il n’y avait aucune page pour une personne.

- **Un profil pour chaque collègue**, à sa propre adresse : nom, avatar, rôle dans votre espace de travail, personnalité, et un résumé de son travail : tickets ouverts, ce qu’il a touché ces trente derniers jours, ce qu’il a terminé. Visible des personnes du même espace de travail, et d’elles seules.
- **Accessible là où l’on croise les gens** : l’infobulle du tableau et l’annuaire des membres y renvoient.
- **Les mentions portent le signal.** Tapez `@` : chaque personne de la liste affiche une ligne de lecture de sa personnalité, par exemple son type et son trait dominant. Elle vient de la même carte en cache que l’infobulle, chargée une fois, si bien qu’ouvrir la liste et y taper n’ajoute aucune requête.

```bf-figure
{
  "kind": "compare",
  "title": "Choisir à qui adresser un message",
  "columns": [
    {
      "title": "Avant",
      "hue": "muted",
      "items": [
        "Une liste de noms",
        "Ouvrir un tableau pour savoir comment quelqu’un travaille",
        "Aucune page à envoyer à un collègue"
      ]
    },
    {
      "title": "Maintenant",
      "hue": "make",
      "items": [
        "Des noms avec une ligne de personnalité",
        "Un profil à un clic de l’infobulle ou de l’annuaire",
        "Résumé du travail à côté de la personnalité"
      ]
    }
  ],
  "caption": "La personnalité façonne le ton, pas les permissions. Rien n’a changé sur qui peut faire quoi."
}
```

```bf-figure
{
  "kind": "devices",
  "title": "La page de profil à trois largeurs",
  "devices": [
    {
      "label": "Ordinateur",
      "width": 1280,
      "hue": "make",
      "note": "En-tête, résumé du travail et personnalité sur une colonne"
    },
    {
      "label": "Tablette",
      "width": 834,
      "hue": "run",
      "note": "Les compteurs passent en lignes"
    },
    {
      "label": "Téléphone",
      "width": 360,
      "hue": "measure",
      "note": "Tout s’empile ; rien ne défile latéralement"
    }
  ],
  "caption": "Largeurs dessinées à l’échelle."
}
```

## Sa place dans la méthode

Builderforce organise le travail en un arc : Idée, Créer, Exécuter, Mesurer. Ce changement touche les trois derniers, et c’est la jonction entre eux qui compte.

**Créer** est l’endroit où vit le tableau et où les tickets se terminent ; c’est là qu’un tableau gagne désormais. **Exécuter** est l’endroit où le travail coûte de l’argent, et le panneau de budget place ce qu’un tableau a gagné à côté de ce que ses exécutions ont coûté. **Mesurer** est l’endroit où l’on découvre si tout cela a compté, et un jalon est la première mesure qui quitte le tableau : il arrive dans la mise à jour investisseurs avec un chiffre derrière lui. La page des personnes relève aussi de Créer. Savoir avec qui l’on travaille, et comment, fait partie de bien créer.

Avant, l’arc se brisait entre Créer et Mesurer : le travail avait lieu et la preuve restait derrière. Elle voyage maintenant avec le travail.

---

**À lire aussi :** [Exécutez l’application que votre tableau vient de construire](/blog/run-your-app-on-the-canvas) · [Votre Evermind privé sur votre machine](/blog/your-private-evermind-on-your-machine)

[Ouvrez un tableau](/tasks) et passez un ticket à Terminé.
