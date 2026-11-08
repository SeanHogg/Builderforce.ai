# Validez, lisez les chiffres, branchez vos propres outils — à l’intérieur de la salle

Trois éléments du canevas étaient terminés et inaccessibles.

**La barrière d’approbation.** Demandez à l’assistant de rééquilibrer un budget et il consigne chaque chiffre qu’il déplace : qui l’a déplacé, de quoi, vers quoi et pourquoi. Les actes qui sortent de l’entreprise ou sur lesquels quelqu’un s’appuiera plus tard — envoyer une campagne, émettre une facture, approuver un budget — sont soumis à une barrière, et un agent ne peut pas approuver sa propre modification. Cette partie fonctionnait. Ce qui ne fonctionnait pas : il n’y avait aucun endroit où une personne puisse voir ce qui attendait et le valider. Le registre se remplissait donc, les actes soumis à barrière restaient bloqués, et « qui a approuvé ce chiffre ? » avait une réponse honnête dont personne ne pouvait rien faire.

**La couche de métriques.** Une métrique sur le canevas est une *définition* — source, filtre, agrégat, cible, sens considéré comme bon — plutôt qu’un chiffre que quelqu’un a saisi dans une tuile : deux tuiles appelées « MRR » ne peuvent donc pas se contredire. Le moteur qui évalue d’un coup tout un ensemble de métriques, ratios dérivés compris, n’avait pas de carte. Chaque définition était correcte, et on ne pouvait en voir aucune avec les autres.

**Les widgets tiers.** Un intégrateur pouvait enregistrer un widget, déclarer ses permissions et le placer sur un tableau via l’API. Rien dans le navigateur ne le montait. Le contrat existait des deux côtés et le rectangle du milieu était vide.

Les trois vivent désormais dans la salle, la surface spatiale unique du canevas, à côté des personnes et de la session.

```bf-figure
{
  "kind": "screen",
  "frame": "La salle, avec ses stations",
  "ratio": 1.62,
  "regions": [
    { "label": "Bureau d’approbation", "note": "Ce qui attend une signature, compté sur sa face", "x": 3, "y": 14, "w": 22, "h": 40, "hue": "prove" },
    { "label": "La session et ses participants", "note": "Le tableau sur la table, l’équipe autour", "x": 30, "y": 22, "w": 38, "h": 52, "hue": "idea" },
    { "label": "Tableau de métriques", "note": "Ce qui est en retard sur la cible d’abord, chaque chiffre avec ses preuves", "x": 72, "y": 14, "w": 22, "h": 40, "hue": "measure" },
    { "label": "Widget sur un socle", "note": "Un outil tiers, actif sur sa face", "x": 72, "y": 58, "w": 22, "h": 30, "hue": "run" },
    { "label": "Liste des stations", "note": "Chaque station, à une touche de distance", "x": 3, "y": 58, "w": 22, "h": 30, "hue": "accent" }
  ],
  "caption": "Chaque station se dresse dans la salle comme une création : vous pouvez la faire glisser n’importe où, la salle se souvient de l’endroit où vous l’avez laissée, et sa légende ouvre un panneau 2D complet. La même liste se trouve à côté de la liste des participants : chaque station est ainsi accessible au clavier, au lecteur d’écran et sur un appareil sans 3D."
}
```

## Le bureau d’approbation

Le bureau montre combien de modifications attendent, et à propos de quoi. Ouvrez-le et chaque objet liste ses changements en attente comme un relecteur a besoin de les lire : le champ, ce qu’il était, ce qu’il est devenu, qui l’a modifié, quand, et d’où vient la nouvelle valeur. Vous choisissez ensuite.

- **Approuver** valide en votre nom chaque modification en attente sur cet objet. La signature appose son cachet sur les mêmes entrées que celles créées par la modification : il n’y a donc jamais d’approbation sans la modification qu’elle a approuvée.
- **Approuver et envoyer** (ou *émettre*, ou *publier*) n’apparaît que lorsque votre signature est exactement ce dont la barrière a besoin pour cet acte. Il signe, puis exécute l’acte, dans cet ordre, en un clic.
- **Refuser** consigne que quelqu’un a regardé et a dit non. Le chiffre n’est pas silencieusement annulé, car ce serait une seconde modification non attribuée. L’acte reste bloqué jusqu’à ce que quelqu’un effectue une modification qu’il est prêt à signer.

```bf-figure
{
  "kind": "flow",
  "title": "Le parcours d’un chiffre, de la modification à l’acte",
  "steps": [
    { "label": "Déplacé", "note": "L’assistant ou un widget modifie une ligne budgétaire. Le déplacement est consigné avec qui, de quoi, vers quoi et pourquoi.", "hue": "build" },
    { "label": "En attente", "note": "La barrière refuse les actes soumis à barrière du budget. Le bureau compte une modification de plus.", "hue": "prove", "tag": "au bureau" },
    { "label": "Signé", "note": "Une personne qui n’a pas fait la modification l’approuve. Vous ne pouvez pas approuver votre propre travail, et un agent ne peut pas approuver du tout.", "hue": "prove" },
    { "label": "Exécuté", "note": "L’acte autorisé par la signature s’exécute, et l’enregistrement indique qui s’en est porté garant.", "hue": "run" }
  ],
  "caption": "La séparation des tâches est une règle unique, lue à la fois par la barrière et par le bureau. Un bureau qui vous laisserait signer ce que la barrière vous refuserait ne serait qu’un moyen de contourner la barrière."
}
```

C’est le contrôle dont un responsable financier ou un directeur marketing a besoin avant de confier un tableau à un agent. C’est aussi la preuve que demande un auditeur : une modification, la personne qui l’a approuvée et le moment, le tout dans un seul enregistrement.

## Le tableau de métriques

Dès qu’une session définit une métrique, un tableau se dresse dans la salle. Chaque métrique du tableau est évaluée en même temps — des agrégats simples sur leurs jeux de données, et des ratios dérivés comme la marge brute ou la rétention nette du chiffre d’affaires via les métriques dont ils sont composés — de sorte que les tuiles ne peuvent pas diverger.

Il se lit d’abord comme une analyse, ensuite comme des tuiles. Les métriques en retard sur la cible viennent en premier. Les métriques qui ne peuvent pas être calculées disent pourquoi, et n’affichent jamais un zéro, car une marge calculée avec une ligne de coût manquante se lit comme 100 % et c’est la réponse fausse la plus dangereuse qu’un tableau de bord puisse donner. Chaque chiffre porte ses preuves : le nombre de lignes à partir desquelles il a été calculé, ou le nombre de métriques dont dépend un chiffre dérivé. Les métriques à granularité temporelle portent une courbe de tendance.

## Des widgets tiers sur un socle

Un widget enregistré pour votre espace de travail et placé sur le tableau s’exécute désormais deux fois : sur sa carte sur le canevas à plat, et sur un socle dans la salle avec le cadre actif sur sa face. Le confinement est ce qui nous importe le plus :

```bf-figure
{
  "kind": "compare",
  "title": "Ce qu’un widget peut et ne peut pas faire",
  "columns": [
    { "title": "Il peut", "hue": "run", "items": ["Lire le titre du tableau et les noms de ses objets, si autorisé", "Créer, modifier et supprimer des objets, si autorisé — par le même chemin de modification qu’une personne", "Conserver un petit stockage privé sur son propre emplacement", "Faire apparaître un avis sur le canevas"] },
    { "title": "Il ne peut pas", "hue": "bad", "items": ["Partager l’origine, les cookies ou le stockage du canevas : il s’exécute dans un bac à sable opaque", "Voir des données d’objet au-delà d’un identifiant, d’un type, d’un titre et d’un statut", "Rediriger un emplacement, changer un mode d’approbation ou toucher au stockage d’un autre widget", "Modifier un chiffre à enjeu financier sans que cette modification attende au bureau d’approbation"] }
  ],
  "caption": "Chaque message est vérifié dans l’ordre du protocole : il provient de ce cadre, le cadre est toujours à son adresse enregistrée, le type figure sur la liste d’autorisation et la permission a été accordée à l’enregistrement. Si le cadre navigue ailleurs que vers son adresse enregistrée, le tableau cesse de lui répondre."
}
```

Cette dernière ligne du côté droit est l’endroit où les trois stations se rejoignent. Un widget avec accès en écriture est un agent du point de vue de la barrière : ses déplacements sur les champs attribués sont consignés au nom du widget et attendent au bureau comme n’importe quelle autre modification.

```bf-figure
{
  "kind": "devices",
  "title": "Le panneau du bureau, aux largeurs que les gens utilisent réellement",
  "devices": [
    { "label": "Ordinateur", "width": 1280, "hue": "prove", "note": "À côté de la salle" },
    { "label": "Tablette", "width": 834, "hue": "measure", "note": "Par-dessus la salle" },
    { "label": "Téléphone", "width": 390, "hue": "run", "note": "Pleine largeur, cibles de 44 px" }
  ],
  "caption": "Le panneau 2D est l’équivalent accessible du fait de s’approcher d’un socle. Il fonctionne sur un téléphone et avec un pointeur grossier, et suit le thème du lecteur."
}
```

## Sa place dans la méthode

La méthode est un arc : **Idée → Réaliser → Exécuter → Mesurer**. À l’intérieur, [Lire → Prouver → Construire](/blog/read-prove-build-the-inner-loop) est la manière de passer d’une idée à quelque chose de réalisé. La boucle se referme dans *Mesurer*, où le chiffre auquel vous vous êtes engagé est confronté à ce qui s’est réellement passé. Ces trois stations se trouvent aux deux extrémités de cet arc qui n’avaient rien sur quoi s’appuyer :

- **Le tableau de métriques est Mesurer** — la condition d’abandon à laquelle une preuve s’est engagée, lue à partir des mêmes définitions que celles utilisées par chaque tuile et chaque rapport.
- **Le bureau d’approbation est la charnière entre Construire et Exécuter.** Ce qu’un agent a construit ne devient quelque chose sur lequel l’entreprise s’appuie qu’une fois validé par une personne nommée.
- **Les widgets amènent vos propres outils dans Exécuter**, de façon confinée, afin qu’un tableau opérationnel puisse utiliser les systèmes dans lesquels votre équipe travaille déjà.

Les fonctionnalités pédagogiques de la salle — pour les classes et les cohortes — arrivent de la même manière, sous forme de stations dans la même salle.

---

**À lire aussi :** [Points d’approbation et supervision humaine](/blog/approval-gates-and-human-oversight) · [Tenez votre point quotidien dans votre tableau](/blog/stand-up-inside-your-board) · [Noter la preuve et boucler la boucle](/blog/grade-the-proof-and-close-the-loop)

[Ouvrez un canevas](/create), demandez à l’assistant de rédiger un budget, puis dirigez-vous vers le bureau.
