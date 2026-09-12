Dessinez le flux d'offboarding une fois. Révoquer les comptes, lancer la dernière paie, récupérer l'ordinateur portable, prévenir l'équipe. Six étapes, reliées, construites, exécutées selon un calendrier. Parfait.

Dessinez maintenant le flux de promotion. Il valide l'augmentation, met à jour le contrat, prévient la paie — et, quelque part au milieu, il gère l'offboarding du prestataire que la promotion vient remplacer.

Encore ces six étapes.

Depuis que le canevas est le workflow, la réponse honnête était : redessinez-les. Et la copie que vous corrigiez n'était jamais celle qui s'exécutait. Quelqu'un corrige l'étape de paie dans le canevas d'offboarding, et quatre autres canevas continuent à procéder à l'ancienne, en silence, selon leur calendrier, pendant des mois.

## Un canevas est désormais une étape

`Run a canvas` est un type d'étape comme un autre. Placez-le, choisissez un canevas, et le flux que vous avez dessiné ailleurs devient une seule carte sur ce tableau.

```bf-figure
{
  "kind": "flow",
  "title": "Une promotion, avec l'offboarding à l'intérieur",
  "steps": [
    { "label": "Valider l'augmentation", "note": "Le point de décision qu'un humain tranche vraiment", "hue": "idea" },
    { "label": "Mettre à jour le contrat", "note": "Documents, signatures, dossier", "hue": "make" },
    { "label": "Exécuter un canevas · Offboarding", "note": "Six étapes qui vivent sur leur propre tableau, avec leur propre auteur et leur propre historique", "hue": "run", "tag": "une étape ici" },
    { "label": "Prévenir la paie", "note": "Transmet ce que le canevas imbriqué a renvoyé", "hue": "measure" }
  ],
  "caption": "Le canevas imbriqué n'est ni une copie ni un lien vers un document. C'est le flux lui-même, exécuté au milieu de celui-ci."
}
```

L'étape est une valeur, pas un nouveau type d'objet — la même règle qui fait d'un nouveau secteur une valeur de `discipline` plutôt qu'un nouveau vocabulaire. Elle se dessine, se relie, se regroupe, se construit et s'exécute donc exactement comme l'étape switch posée à côté.

## Ce qu'il accepte se lit sur le tableau, il ne se déclare pas

La conception tentante consiste à placer une carte de contrat sur le canevas enfant : une liste de paramètres, une liste de retours, auxquels le parent se lie. C'est explicite, c'est stable, et ça tourne mal dès le premier après-midi où quelqu'un ajoute une étape — parce qu'il existe alors deux énoncés de ce dont le canevas a besoin, et celui qui s'exécute n'est pas celui que les gens lisent.

Il n'y a donc pas de carte de contrat. L'interface est déduite du flux effectivement dessiné :

```bf-figure
{
  "kind": "compare",
  "title": "D'où vient une interface",
  "columns": [
    { "title": "Un contrat déclaré", "hue": "muted", "items": ["L'auteur rédige la liste des paramètres", "L'auteur rédige la liste des retours", "Quelqu'un ajoute une étape", "La liste et le flux divergent", "Le flux l'emporte, en silence"] },
    { "title": "Déduite du tableau", "hue": "make", "items": ["Une étape que rien n'alimente est le point d'entrée des données", "Ce que cette étape déclare nécessiter EST un paramètre", "Une variable que rien en aval ne lit EST un retour", "Ajoutez une étape et l'interface suit", "Il n'y a rien à synchroniser"] }
  ],
  "caption": "La même règle que le tableau suit déjà pour déterminer ce qui constitue une section exécutable : interroger le dessin, jamais un marqueur que quelqu'un doit penser à mettre à jour."
}
```

Choisissez un canevas dans l'étape et elle vous indique sur-le-champ ce que ce canevas attend et ce qu'il renvoie — sans que vous ayez à l'ouvrir.

## Figé, ou en direct

La réutilisation soulève une question qui n'a pas de réponse unique ; l'étape vous la pose donc.

```bf-figure
{
  "kind": "compare",
  "title": "Deux façons de dépendre du canevas de quelqu'un d'autre",
  "columns": [
    { "title": "Instantané — par défaut", "hue": "make", "items": ["Les étapes de l'enfant sont copiées dans ce flux à la compilation", "Une définition, une exécution, une chronologie", "Les modifications faites là-bas ne changent rien ici tant que vous ne recompilez pas", "Ce que vous avez livré est ce qui s'exécute"] },
    { "title": "En direct — sur option", "hue": "run", "items": ["Ce flux stocke une référence vers la compilation propre à l'enfant", "L'enfant est relu à chaque exécution de ce flux", "Corrigez le canevas d'offboarding une fois ; chaque appelant en profite", "L'enfant doit y avoir été compilé au moins une fois"] }
  ],
  "caption": "Un sous-programme partagé appelle En direct. Un flux qui doit continuer à se comporter comme au moment de son approbation appelle Instantané. Les deux se choisissent dans une seule liste déroulante de l'étape."
}
```

Aucun des deux modes de liaison n'a le droit d'échouer en silence. Un canevas illisible, un canevas sans étape, un canevas contenant une étape qui attend encore un prompt, un canevas qui s'appelle lui-même, et une composition imbriquée au-delà de cinq niveaux sont tous des **refus** — la compilation s'arrête et le message nomme le canevas. C'est délibéré, et c'est la même règle que le compilateur a toujours appliquée à une étape sans appel : un flux qui s'exécute, signale un succès et ne fait pas ce qu'il doit faire est pire qu'un flux qui refuse de se compiler.

## Sa place dans la méthode

La composition relève de **Créer**, le troisième acte et le plus coûteux, mais ce qu'elle change réellement, c'est ce qui se passe ensuite — dans Piloter et Mesurer.

[Lire et Prouver](/blog/read-prove-build-the-inner-loop) viennent d'abord, pour que la décision de construire soit une décision. La composition, elle, consiste à faire en sorte que ce que vous avez décidé de construire vaille la peine d'être conservé. Un processus dessiné une fois et réutilisé est un processus que vous pouvez *améliorer* une fois : la correction de la paie arrive à un seul endroit, et tout ce qui en dépend est juste dès l'exécution suivante, parce que les appelants détiennent une référence et non une copie.

```bf-figure
{
  "kind": "stack",
  "title": "Ce que chaque acte gagne à ce qu'un canevas soit réutilisable",
  "bands": [
    { "label": "Créer", "note": "Dessinez la partie commune une fois. Le flux de promotion dit « puis l'offboarding » comme il dit « puis envoyer la lettre ».", "hue": "make" },
    { "label": "Piloter", "note": "Les étapes imbriquées apparaissent dans la chronologie du parent, sous le nom du canevas enfant — une exécution à suivre, un point d'approbation, un seul endroit où regarder.", "hue": "run", "tag": "en direct ou figé" },
    { "label": "Mesurer", "note": "Corrigez l'étape commune dans son propre canevas et chaque flux qui l'appelle est juste dès l'exécution suivante. Une correction, pas sept.", "hue": "measure" }
  ],
  "caption": "L'arc ne gagne pas d'étape. Ce qu'il gagne, c'est que le même travail cesse d'être redessiné à chaque étape qui en a besoin."
}
```

## Ce que vous pouvez en faire dès aujourd'hui

- **Transformer n'importe quel canevas en étape réutilisable** — sans export, sans modèle, sans copie. C'est le canevas lui-même, en exécution.
- **Voir ce qu'il attend avant de le relier** — paramètres et retours, déduits du tableau enfant et affichés dans l'étape.
- **Choisir s'il est figé ou en direct** — une compilation sur laquelle vous pouvez raisonner, ou un sous-programme partagé dont chaque appelant hérite.
- **Composer jusqu'à cinq niveaux**, une auto-référence ou une chaîne trop profonde étant refusée nommément plutôt que découverte sous la forme d'une exécution bloquée.

Onboarding, offboarding, validation des achats, communication d'incident, renouvellement de contrat : chaque organisation en compte huit comme ceux-là, chacun apparaissant dans une douzaine de flux plus larges. Ça a toujours été le même flux. C'est désormais le même objet.

---

**À lire aussi :** [Le canevas est le workflow](/blog/creation-canvas-beyond-chat) · [Exécutez l'app que votre tableau vient de construire](/blog/run-your-app-on-the-canvas) · [Points d'approbation et supervision humaine](/blog/approval-gates-and-human-oversight)

[Ouvrez un canevas](/create), dessinez le flux que tout le monde redessine sans cesse, et placez-le dans le suivant.
