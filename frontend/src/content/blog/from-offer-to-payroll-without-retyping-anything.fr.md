# De l’offre à la paie sans rien ressaisir

Deux vocabulaires, tous deux corrects, côte à côte sans rien entre eux.

Le recrutement possédait l’entonnoir : offre d’emploi, présélection, entretien, proposition. Les personnes possédaient la relation d’emploi : salarié, cycle de vie, intégration, évaluations. Les deux en-têtes décrivaient la transition entre eux avec autant de mots — *« une proposition qui devient un salarié »*. Aucun ne l’exécutait. Le produit livrait deux entonnoirs qui s’arrêtaient à un pied l’un de l’autre, et l’écart était comblé par une personne qui recopiait des champs d’un écran à l’autre.

## La passation, et ses trois refus

```bf-figure
{
  "kind": "flow",
  "title": "Proposition → salarié, en une étape",
  "steps": [
    { "label": "Proposition signée", "note": "Le déclencheur. Pas un accord verbal accepté, pas une proposition à l’état de brouillon : une proposition signée.", "hue": "reach" },
    { "label": "Transporter les faits", "note": "Intitulé, lieu et base de l’offre d’emploi ; compétences et preuves du candidat ; date de début de la proposition. Rien d’inventé.", "hue": "run" },
    { "label": "Salarié + cycle de vie", "note": "Le dossier d’emploi et le plan d’intégration, créés ensemble et rattachés à la proposition dont ils proviennent.", "hue": "measure" }
  ],
  "caption": "La passation n’appartient à AUCUN des deux vocabulaires. La placer dans celui du recruteur permettrait au recrutement de rédiger des dossiers RH ; la placer dans celui des RH permettrait aux RH de lire les champs du recruteur. Elle est déclarée une seule fois, entre les deux."
}
```

Elle refuse dans trois cas, et chaque refus est du type utile :

- **La proposition n’est pas signée.** Un dossier d’emploi qui part d’une proposition non signée est le dossier de quelque chose qui n’a pas eu lieu.
- **Aucune personne n’est rattachée.** Un salarié sans candidat derrière lui est l’endroit où naît un doublon de fiche personne.
- **Il n’y a pas de date de début.** Un cycle de vie sans date d’ancrage n’a aucune échéance, de sorte que chaque tâche d’intégration qu’il contient est silencieusement sans date.

Elle lève une erreur plutôt que de créer une paire à moitié renseignée, car une moitié de recrutement est pire que rien : on s’en aperçoit trois semaines plus tard quand la paie demande qui est cette personne.

En complément, chaque CV noté est désormais rattaché à un véritable candidat. Noter un document qui n’appartient à personne produit un chiffre sur lequel on ne peut pas agir, et un tas de documents produit une présélection que personne ne peut assembler.

## Lisez le système RH que vous exploitez déjà

Le catalogue pouvait publier une demande de recrutement vers l’extérieur et relire un cycle de paie, mais n’avait aucun moyen de lire vos **propres** collaborateurs. Les salariés, les affectations de rôles, la capacité et chaque chiffre d’effectif des vues de livraison étaient donc saisis à la main, et « qui travaille réellement ici » vivait dans un système que ce produit ne pouvait pas atteindre.

```bf-figure
{
  "kind": "stack",
  "title": "Sept façons de répondre à « qui travaille ici »",
  "bands": [
    { "label": "Workday", "note": "Travailleurs, organisation, affectations.", "hue": "run" },
    { "label": "BambooHR · HiBob · Personio", "note": "Le trio du marché intermédiaire, chacun avec sa propre idée d’un dossier d’emploi.", "hue": "run" },
    { "label": "SAP SuccessFactors", "note": "Pour les parcs où le système RH précède le produit qu’il décrit.", "hue": "run" },
    { "label": "Greenhouse", "note": "Le côté ATS — candidats et pipelines, lus à côté des personnes qu’ils deviennent.", "hue": "reach" },
    { "label": "Annuaire SCIM 2.0", "note": "Le lecteur générique, pour tout ce qui ne figure pas sur cette liste.", "hue": "muted" }
  ],
  "caption": "Chaque action de la catégorie est une LECTURE, et un test fait échouer la compilation si cela cesse un jour d’être vrai."
}
```

Cette dernière ligne est la décision de conception, pas un détail d’implémentation. Un système RH est le système de référence de l’emploi des personnes. Un outil qui peut y écrire est un outil qui peut discrètement se tromper sur le salaire, le titre ou la date de fin de contrat de quelqu’un, et l’impact de cela touche la vie d’une personne plutôt qu’un tableau de bord. La lecture seule est appliquée, testée et énoncée là où quiconque intègre peut la voir.

## Ce que cela change pour un chiffre d’effectif

```bf-figure
{
  "kind": "compare",
  "title": "D’où vient un chiffre de capacité",
  "columns": [
    { "title": "Saisi", "hue": "bad", "items": ["Juste le jour de la saisie", "Faux dès le premier départ", "Personne ne sait quand il a été vérifié pour la dernière fois", "Donc personne ne fait confiance au plan bâti dessus"] },
    { "title": "Lu", "hue": "good", "items": ["Vient du système qui détient le fait", "Bouge quand l’organisation bouge", "Porte sa provenance", "Un plan bâti dessus peut être discuté"] }
  ],
  "caption": "La même règle que le vieillissement d’une facture ou un pourcentage sur un tableau de capitalisation : un chiffre qui peut être saisi est un chiffre qui finira par contredire la réalité."
}
```

Les deux moitiés de ceci appartiennent à la même étape de l’arc : le Marché, c’est *vendre, acheter, recruter, être trouvé*, et l’Exécution, c’est ce qui se passe une fois la personne réellement à la paie. La passation est la couture entre les deux, et c’est désormais quelque chose que le produit exécute plutôt que quelque chose qu’il décrit.

---

**À lire aussi :** [Le back-office du fondateur](/blog/the-founder-back-office-money-ownership-and-paperwork) · [Comment construire un organigramme qui reste exact](/blog/how-to-build-an-org-chart-that-stays-accurate) · [Grilles d’évaluation structurées et relecture à l’aveugle](/blog/structured-scorecards-and-blind-review-to-reduce-hiring-bias)

Consultez le [catalogue d’intégrations](/integrations), ou [ouvrez un canevas](/create) et placez l’entonnoir à côté du travail qu’il doit doter en personnel.
