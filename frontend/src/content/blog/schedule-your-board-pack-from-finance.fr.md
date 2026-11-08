# Planifiez le dossier du conseil une fois, et cessez de le reconstruire chaque mois

Le dossier de conseil de fin de mois est le même document à chaque fois. Trésorerie, consommation, les trois chiffres sur lesquels votre secteur est jugé, une ligne sur les recrutements et une ligne sur la levée de fonds. Quelqu’un le reconstruit pourtant. Il exporte un graphique, le colle dans des diapositives, corrige l’axe qui s’est cassé et l’envoie à 23 h le dernier jour ouvré.

La plateforme savait déjà faire cette partie. Une planification de rapport pouvait livrer un cadre de canevas comme dossier du conseil chaque mois, et une tâche cron l’envoyait. Simplement, vous ne pouviez pas voir cette planification, ni la modifier, ni en créer une depuis n’importe quelle page du produit. Les seules planifications que l’on pouvait trouver étaient celles de l’exécution QA. Tout le reste était une route d’API et une ligne de base de données.

## L’onglet Rapports

Finance dispose désormais d’un quatrième onglet, après Trésorerie, Flux de trésorerie et Tableau de bord : **Rapports**.

```bf-figure
{
  "kind": "screen",
  "frame": "Finance ▸ Rapports",
  "ratio": 1.62,
  "regions": [
    { "label": "Rapports planifiés", "note": "Toutes les planifications que cet espace de travail livre : type, cadence, destinataires, prochain envoi", "x": 4, "y": 8, "w": 58, "h": 74, "hue": "run" },
    { "label": "Missions de validation", "note": "Les expériences, tableaux de bord et collecteurs sur lesquels reposent les chiffres", "x": 65, "y": 8, "w": 31, "h": 74, "hue": "measure" },
    { "label": "Nouvelle planification", "x": 4, "y": 88, "w": 24, "h": 8, "hue": "accent" },
    { "label": "Modifier · suspendre · supprimer, par ligne", "x": 32, "y": 88, "w": 64, "h": 8, "hue": "accent" }
  ],
  "caption": "Deux éléments qui chargent chacun leurs propres données. Aucun n’attend le rapport de trésorerie que partagent les onglets Trésorerie et Flux de trésorerie."
}
```

Chaque ligne indique ce qui est envoyé, à quelle fréquence, à quelle heure et à combien de personnes. Elle indique aussi quand aura lieu le prochain envoi. **Suspendre** arrête une planification sans la perdre, ce qui est utile pour le trimestre où vous faites votre rapport en personne. **Supprimer** demande d’abord une confirmation. **Modifier** ouvre la planification dans un panneau latéral, par-dessus la page, afin de garder votre place dans la liste.

## Un dossier du conseil porte sur quelque chose

Cinq des six types de rapports portent sur l’ensemble de l’espace de travail : le point quotidien, la revue de code, l’état du projet, la synthèse exécutive et la consolidation du portefeuille. Le dossier du conseil est le premier à porter sur *quelque chose* : un cadre sur l’un de vos tableaux. Le créer comporte donc une étape que les autres n’ont pas.

```bf-figure
{
  "kind": "flow",
  "title": "Planifier un dossier du conseil",
  "steps": [
    { "label": "Choisir le tableau", "note": "Vos tableaux actifs, la même liste que celle de la galerie du canevas.", "hue": "idea" },
    { "label": "Choisir le cadre", "note": "Seulement les cadres que le serveur acceptera, chacun avec son nombre de tuiles.", "hue": "make" },
    { "label": "Cadence et destinataires", "note": "Quotidienne, hebdomadaire ou mensuelle, à l’heure de votre choix, pour les personnes que vous listez.", "hue": "run", "tag": "dans Finance" }
  ],
  "caption": "La liste des cadres provient du même contrôle que celui de l’enregistrement. Un cadre que vous pouvez choisir est un cadre qui sera accepté : rien n’échoue donc plus tard, à 23 h."
}
```

Ce dernier point compte. Un dossier du conseil sans cadre partirait chaque mois avec « rien à envoyer » : le serveur le refuse donc. Un cadre sur un tableau que cet espace de travail ne peut pas lire est refusé lui aussi. Le sélecteur lit sa liste depuis la route qui effectue ce contrôle : il ne peut donc pas proposer un cadre que l’enregistrement refuserait. Le formulaire ne vous laisse pas non plus soumettre un dossier du conseil tant que vous n’avez pas choisi de cadre.

**Les destinataires sont ce que vous collez.** Virgules, points-virgules, un par ligne, ou `Ann Lee <ann@example.com>` copié depuis un client de messagerie : tout fonctionne. Tout ce qui n’est pas une adresse vous est signalé, de sorte que rien n’est écarté en silence.

**Ce qui peut changer après la création, c’est ce que la planification peut réellement changer.** Vous pouvez modifier l’heure, les destinataires et l’activation. Le type de rapport, la cadence et le cadre sont figés une fois la planification créée, et le formulaire le dit plutôt que de proposer des modifications qui seraient perdues. Pour envoyer un autre cadre, créez une nouvelle planification. Cela prend une vingtaine de secondes.

## Les preuves, sur la même page

À côté des planifications se trouve une petite carte qui n’avait jusqu’ici aucun foyer. Elle liste les expériences, les tableaux de bord de validation et les collecteurs de retours que votre espace de travail exécute. Chacun indique ce qu’il est et son statut actuel, et les collecteurs montrent combien de réponses ils ont reçues.

```bf-figure
{
  "kind": "compare",
  "title": "Ce que dit un dossier du conseil, et ce sur quoi il repose",
  "columns": [
    { "title": "Le dossier", "hue": "run", "items": ["Trésorerie et consommation", "Les tuiles d’indicateurs du secteur", "Recrutements et levée de fonds", "Envoyé selon une cadence, sans changement"] },
    { "title": "Les preuves", "hue": "measure", "items": ["Quels paris sont validés", "Lesquels sont encore en cours", "Quels collecteurs écoutent", "Combien de personnes ont répondu"] }
  ],
  "caption": "Un chiffre sans expérience derrière lui est une supposition avec une virgule. Les placer côte à côte est la façon de voir quels chiffres vous pouvez défendre."
}
```

## Sa place dans la méthode

C’est Exécuter, l’étape où l’entreprise se maintient en marche, et le travail consiste ici à instaurer une habitude qui ne dépend pas du fait que quelqu’un s’en souvienne.

```bf-figure
{
  "kind": "stack",
  "title": "Le reporting, sur l’arc",
  "bands": [
    { "label": "Idée", "note": "Le tableau où le plan a été débattu", "hue": "idea" },
    { "label": "Réaliser", "note": "Le cadre que vous tracez autour des tuiles qui comptent", "hue": "make" },
    { "label": "Exécuter", "note": "Finance ▸ Rapports. Le cadre part selon une cadence, vers les personnes qui en ont besoin.", "hue": "run" },
    { "label": "Mesurer", "note": "Missions de validation : les preuves sur lesquelles repose chaque chiffre", "hue": "measure" },
    { "label": "Portée", "note": "Le conseil, les investisseurs et l’équipe, atteints de la même manière chaque mois", "hue": "reach" }
  ],
  "caption": "Le dossier du conseil est créé sur le canevas et livré depuis Exécuter. Le cadre que vous modifiez le mardi est celui qui arrive le premier du mois."
}
```

Auparavant, Exécuter avait les chiffres (Trésorerie, Flux de trésorerie, le tableau de bord du secteur) mais aucun moyen de les *envoyer*. Sans planification, le reporting signifiait reconstruire la présentation chaque mois. Avec une planification, vous la construisez une fois. Vous modifiez le cadre sur le tableau quand quelque chose change, et la planification envoie ce que le cadre affiche le jour de l’envoi.

## Ce que vous pouvez en faire dès aujourd’hui

- **Planifier n’importe lequel des six rapports** de façon quotidienne, hebdomadaire ou mensuelle, à l’heure de votre choix (en UTC), pour les personnes que vous listez.
- **Envoyer un dossier du conseil depuis un cadre de canevas.** Choisissez le tableau, puis le cadre, et les tuiles qu’il contient partent selon cette cadence.
- **Suspendre, modifier ou supprimer** une planification depuis la même liste, sans ouvrir l’API ni solliciter un administrateur.
- **Voir les preuves à côté.** Expériences, tableaux de bord de validation et collecteurs de retours figurent sur la même page que les rapports.

Créer et modifier des planifications exige un rôle de manager. Toute personne qui n’en a pas voit les commandes désactivées, avec le rôle qu’il lui faudrait nommé à côté, plutôt que masquées.

---

**À lire aussi :** [Les indicateurs sur lesquels tourne réellement votre secteur, installés en un clic](/blog/install-your-verticals-kpi-dashboard) · [Exécutez l’application que votre tableau vient de construire](/blog/run-your-app-on-the-canvas)

[Ouvrez Finance ▸ Rapports](/finance?tab=reports) et planifiez le dossier que vous construiriez sinon à 23 h.
