# Référencez votre start-up, rencontrez des investisseurs et surveillez votre trésorerie sur le même tableau

Vous pouvez porter une idée sur un canevas, la transformer en objets à force de discussion, construire la chose, l’exploiter comme une entreprise et lire si cela a fonctionné. Ensuite, il faut que quelqu’un la finance — et jusqu’à cette semaine, la plateforme n’avait aucune porte par laquelle un investisseur puisse entrer.

Le poste du PDG avait une levée de fonds : le tour, les salles de données, les lacunes de due diligence, le dossier de levée. Chacun de ces éléments suppose que l’investisseur est déjà dans la pièce. Rien ne plaçait une entreprise devant un inconnu, et rien ne permettait à l’inconnu de dire « je suis intéressé » sans qu’un fondateur l’ait d’abord trouvé. L’entreprise existait. Elle ne pouvait pas être *trouvée*.

## L’entreprise obtient une vitrine publique

```bf-figure
{
  "kind": "flow",
  "title": "D’une ligne d’entreprise à la demande d’un investisseur",
  "steps": [
    { "label": "Référencer", "note": "Investisseurs → Référencement. Trois étapes : l’entreprise, ses chiffres, ce qu’elle recherche. Chaque étape s’enregistre au fur et à mesure.", "hue": "run" },
    { "label": "Être trouvé", "note": "Place de marché → Entreprises. Stade, secteur, traction et levée en cours, filtrés comme le pense un investisseur.", "hue": "reach" },
    { "label": "Recevoir une réponse", "note": "Manifester son intérêt arrive dans Investisseurs → Intérêts, à côté de tous les autres contacts entrants, avec les statuts de triage propres au directeur commercial.", "hue": "run", "tag": "dans votre espace de travail" }
  ],
  "caption": "Une seule ligne d’entreprise, trois rédacteurs. Le référencement est une facette de l’entreprise que vous dirigez déjà, pas un profil que vous entretenez à côté."
}
```

Le référencement n’est pas un nouvel objet. C’est l’entreprise que vous avez déjà — celle à laquelle vos projets se rattachent, celle pour laquelle le dossier est construit — avec une vitrine publique activée. Cela compte pour une seule raison : les chiffres que lit un investisseur sont ceux que vous avez déclarés, une seule fois, et la trésorerie qu’il voit est calculée à partir de ces chiffres par la même formule que celle de votre poste de directeur financier. Il n’y a rien à synchroniser, car il n’y a qu’une seule chose.

```bf-figure
{
  "kind": "screen",
  "frame": "Place de marché → Entreprises",
  "ratio": 1.62,
  "regions": [
    { "label": "Pastilles de stade", "note": "De l’autofinancement à l’entrée en bourse, plus Levée en cours", "x": 4, "y": 6, "w": 92, "h": 9, "hue": "reach" },
    { "label": "Secteur · stade d’activité · tri", "x": 4, "y": 17, "w": 92, "h": 7, "hue": "reach" },
    { "label": "Une start-up référencée", "note": "Slogan, stade, secteur, financement total, MRR, équipe, santé de la trésorerie — et Manifester son intérêt", "x": 4, "y": 27, "w": 29, "h": 48, "hue": "run" },
    { "label": "Une start-up référencée", "x": 35.5, "y": 27, "w": 29, "h": 48, "hue": "run" },
    { "label": "Une start-up référencée", "x": 67, "y": 27, "w": 29, "h": 48, "hue": "run" },
    { "label": "Pour les investisseurs", "note": "Parcourir les entreprises en levée", "x": 4, "y": 79, "w": 44, "h": 16, "hue": "accent" },
    { "label": "Pour les start-ups", "note": "Créer votre profil", "x": 52, "y": 79, "w": 44, "h": 16, "hue": "accent" }
  ],
  "caption": "Les fiches de start-ups sont une famille de la vitrine unique, aux côtés des talents, des agents et des ressources, et non une cinquième place de marché."
}
```

## Ce qu’un inconnu voit, et ce qu’il ne voit jamais

Un annuaire qui montre tout est un annuaire où personne ne se référence. La fiche montre donc ce sur quoi un investisseur décide, et rien de ce qui nuit à un fondateur s’il le publie :

```bf-figure
{
  "kind": "compare",
  "title": "Deux lecteurs, une règle",
  "columns": [
    { "title": "Un visiteur", "hue": "reach", "items": ["Nom, slogan, description", "Stade de financement, secteur, stade d’activité", "Total levé, chiffre d’affaires mensuel, taille de l’équipe", "Si l’entreprise est en levée", "SANTÉ de la trésorerie — critique, à surveiller, saine, rentable"] },
    { "title": "Un lecteur connecté", "hue": "run", "items": ["Tout ce que voit un visiteur", "Trésorerie en MOIS", "Le contact investisseur que le fondateur a choisi de publier", "Jamais la trésorerie disponible. Jamais la consommation."] }
  ],
  "caption": "La règle de niveau vit dans une seule fonction côté serveur. L’annuaire et la page de profil passent tous deux par elle : aucun ne peut donc divulguer ce que l’autre cache."
}
```

La trésorerie et la consommation sont les deux chiffres qu’un concurrent aimerait le plus lire. Ils restent dans l’espace de travail. La fiche porte la tranche de santé de la trésorerie — assez pour qu’un investisseur sache s’il doit se hâter — et un lecteur connecté obtient les mois. Appuyer sur **Manifester son intérêt** écrit une ligne dans le tenant du fondateur : la même ligne de flux d’affaires que celle triée par la file du directeur commercial, avec le message de l’investisseur, l’instrument qu’il envisage et le calendrier. Le fondateur est notifié, la lit dans **Investisseurs → Intérêts** et la marque *en discussion*, *investit* ou *décliné*. Quand c’est sérieux, il invite l’investisseur dans l’entreprise — un seul accord de confidentialité, toutes les salles de données — et le reste de la levée se déroule là où il se déroulait déjà.

## La trésorerie, avec sa provenance nommée

BurnRateOS affichait un seul chiffre de trésorerie et l’on ne pouvait pas savoir s’il provenait d’un flux bancaire ou d’un formulaire. Finance s’ouvre désormais sur deux colonnes et les étiquette.

```bf-figure
{
  "kind": "screen",
  "frame": "Finance → Trésorerie",
  "ratio": 1.7,
  "regions": [
    { "label": "OBSERVÉ", "note": "Trésorerie, consommation nette, MRR et mois — à partir des dépenses approuvées, de la paie traitée et des comptes connectés, recalculés chaque jour", "x": 4, "y": 6, "w": 45, "h": 44, "hue": "measure" },
    { "label": "DÉCLARÉ", "note": "Trésorerie disponible, dépenses mensuelles, coût de l’équipe, chiffre d’affaires — ce que vous nous avez indiqué, modifiable ici, avec le verdict à côté", "x": 51, "y": 6, "w": 45, "h": 44, "hue": "run" },
    { "label": "Mois par mois", "note": "Chiffre d’affaires · dépenses · consommation nette · trésorerie en fin de mois, pour les mois observés", "x": 4, "y": 54, "w": 92, "h": 40, "hue": "measure" }
  ],
  "caption": "Deux provenances, jamais mélangées. Une trésorerie calculée à partir de chiffres saisis l’indique à côté du chiffre, pas dans une note de bas de page."
}
```

L’arithmétique est la même partout où elle apparaît — le calculateur gratuit de la page Business Intelligence, l’étape d’intégration du fondateur, la fiche de référencement et la vue du directeur financier — parce qu’elle est écrite une fois et testée une fois. Elle divise la trésorerie par la consommation *nette*. Une entreprise qui dépense 100 k$ et gagne 80 k$ consomme 20 k$, et la version de cette formule qui divise par les dépenses brutes annonce un cinquième de la vraie trésorerie. C’est la seule erreur lourde de conséquences possible ici, et c’est la raison pour laquelle il y a une formule plutôt que quatre.

Le flux de trésorerie se tient à côté : entrées, sorties, net et solde final, mois par mois, sous forme de graphique et de tableau, pour les mois observés par la plateforme et pour la projection à votre consommation déclarée. Vous choisissez quelle série s’affiche à l’écran, et la légende du graphique la nomme.

## Sa place dans la méthode

L’Exécution et la Portée, et la couture entre les deux.

```bf-figure
{
  "kind": "stack",
  "title": "L’entreprise, sur l’arc",
  "bands": [
    { "label": "Idée", "note": "Le canevas dans lequel le produit a été discuté", "hue": "idea" },
    { "label": "Réaliser", "note": "Les projets rattachés à l’entreprise", "hue": "make" },
    { "label": "Exécuter", "note": "Finance → Trésorerie et Flux de trésorerie. Le chiffre du directeur financier, avec sa source nommée.", "hue": "run" },
    { "label": "Mesurer", "note": "Des faits observés, recalculés chaque jour, à côté de ce que vous avez déclaré", "hue": "measure" },
    { "label": "Portée", "note": "Place de marché → Entreprises. L’entreprise est trouvée ; l’intérêt revient dans Exécuter.", "hue": "reach" }
  ],
  "caption": "Le référencement est une surface de Portée qui écrit dans Exécuter. Une demande est un flux d’affaires entrant, pas une notification."
}
```

Exécuter en avait besoin parce qu’une entreprise qui ne peut pas énoncer sa trésorerie ne peut pas dire combien de temps elle a pour lever des fonds. La Portée en avait besoin parce qu’une entreprise qui ne peut pas être trouvée ne peut pas lever du tout. Le référencement boucle aussi la boucle dans l’autre sens : la demande d’un investisseur est le premier signal de Mesure qu’une levée produit — combien de personnes ont regardé, combien ont demandé — et elle arrive sur le même tableau où se construit la chose à propos de laquelle ils posent la question.

Partez de la porte de la place de marché, ou du calculateur, ou d’**Investisseurs → Référencement**. Trois étapes plus tard, l’entreprise est référencée, sa trésorerie est dans Finance, et le prochain inconnu qui la trouvera pourra vous le dire.
