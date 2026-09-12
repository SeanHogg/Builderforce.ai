Les outils de diagramme sont particulièrement doués pour la prise d'otages. Le travail a de la valeur, le fichier est propriétaire, et les options d'export sont conçues pour que la seule sans perte soit celle qu'on ne peut ouvrir nulle part ailleurs. Les équipes finissent par payer une licence que personne n'utilise, dans le seul but de rouvrir de temps en temps une image dessinée il y a quatre ans.

Voici un guide pratique pour récupérer ce travail — ce que chaque voie préserve réellement, laquelle emprunter, et que faire quand vous n'avez rien d'autre qu'un PNG.

[Ouvrir un Canvas de création →](/create/new)

## La hiérarchie des exports

Tous les exports ne se valent pas, et la différence tient à ce qui survit : la **structure**, ou seulement l'**apparence**.

```bf-figure
{
  "kind": "stack",
  "title": "Ce que vous récupérez, du meilleur au pire",
  "bands": [
    { "label": "Format natif", "note": ".vsdx, .excalidraw, .drawio — formes, libellés, connexions, et quelle forme chaque flèche relie. Tout survit.", "hue": "good", "tag": "sans perte" },
    { "label": "SVG", "note": "Formes, libellés et lignes, mais les connexions deviennent de la géométrie : le fichier ne dit plus quelles boîtes une flèche relie. Récupérable.", "hue": "prove", "tag": "structurel" },
    { "label": "PDF", "note": "Vectoriel, mais les formes sont dessinées comme des tracés sans identité. Un rectangle, ce sont quatre segments.", "hue": "measure", "tag": "marginal" },
    { "label": "PNG / JPG", "note": "Des pixels. Rien à récupérer. On peut l'intégrer, l'annoter et redessiner à côté — mais pas le modifier.", "hue": "bad", "tag": "terminal" }
  ],
  "caption": "Prenez toujours le meilleur niveau que votre outil propose. L'écart entre SVG et PNG, c'est l'écart entre un diagramme et la photo d'un diagramme."
}
```

## Visio → le canevas

**À prendre :** le `.vsdx` lui-même. Déposez-le sur un tableau.

Visio est le format entrant le plus courant, et celui que l'on croit le plus souvent être une impasse. Il n'en est rien — un `.vsdx` est une archive ZIP OPC, le même type de conteneur qu'un `.docx`, avec les formes dans `visio/pages/page1.xml`.

Ce qui passe : la position et la taille de chaque forme, son texte, la forme maître dont elle est issue (c'est ainsi qu'une forme maître *Decision* devient un losange et un *Terminator* une ellipse), et ses connecteurs — y compris les formes que relie chaque connecteur, tirées du bloc `<Connects>`, le seul endroit où le fichier l'indique.

Deux conversions ont lieu à l'import, et ce sont précisément les deux points sur lesquels tous les lecteurs Visio naïfs se trompent : les coordonnées sont exprimées en **pouces depuis le coin inférieur gauche de la page**, et une forme est positionnée par son **centre**, pas par son coin. Ratez l'un des deux et le dessin arrive à l'envers, décalé d'une demi-forme.

**Pour le retour :** convertissez en Draw.io. Visio importe les fichiers `.drawio` : c'est ça, l'aller-retour. L'écriture directe de `.vsdx` n'est pas proposée, et c'est délibéré — un package Visio valide exige des types de contenu corrects, trois parties de relations, une partie document et une partie formes maîtres, et Visio ne se montre pas indulgent face à un fichier subtilement incorrect. Il refuse tout simplement de l'ouvrir.

**Dessins multipages :** seule la première page est lue. Un objet du canevas correspond à un seul diagramme, et empiler cinq pages les unes sur les autres serait pire que de lire celle sur laquelle le fichier s'ouvre.

## Lucidchart → le canevas

**À prendre :** `File → Export → Visio (.vsdx)` si votre offre l'inclut. Sinon, `SVG`.

L'export `.vsdx` de Lucidchart est de bonne qualité et emprunte la voie Visio décrite ci-dessus. Si votre offre ne l'inclut pas — ou si le compte a déjà expiré, ce qui est généralement la raison pour laquelle vous lisez ceci — exportez en SVG et déposez le fichier.

Un SVG déposé sur le tableau reste une **Image**, volontairement : le SVG d'un logo est une image, et le transformer en « diagramme avec un mystérieux rectangle » serait l'erreur inverse. Sélectionnez-le et choisissez **Convertir en diagramme**, et les formes reviennent :

- `<rect>` devient une boîte, arrondie si elle a un `rx`
- `<circle>` et `<ellipse>` deviennent des ellipses
- `<polygon>` est lu d'après ses sommets — trois points font un triangle, quatre placés au milieu des côtés de la boîte un losange de décision, six un hexagone
- `<line>`, `<polyline>` et les tracés `<path>` droits deviennent des connecteurs
- un `<text>` dont l'ancre tombe à l'intérieur d'une forme devient le libellé de cette forme ; un texte qui n'appartient à rien devient un libellé autonome au lieu d'être jeté

La seule chose qu'un SVG ne peut pas vous dire, c'est quelles formes une flèche relie — il n'a que des coordonnées. Cette information est reconstituée géométriquement : une flèche dont les extrémités tombent dans deux boîtes *est* une relation entre elles. Sans cette étape, tous les connecteurs disparaîtraient dès que vous convertiriez le résultat en Mermaid.

## Miro → le canevas

**À prendre :** l'export PDF ou image du tableau, comme référence — puis reconstruisez les parties qui comptent.

C'est la réponse honnête. L'export de Miro est une image, et il n'y a aucune structure à récupérer dans une image. Ce que le canevas vous offre, c'est une meilleure boucle de reconstruction plutôt qu'un import magique :

1. Déposez l'export sur le tableau — il arrive sous forme d'Image.
2. Placez un objet Diagramme à côté et demandez à Brain de le redessiner en Mermaid, en s'appuyant sur l'image.
3. Corrigez le résultat sous forme de texte, ce qui prend quelques minutes plutôt que des heures à redéplacer des boîtes.

L'image reste sur le tableau à côté du diagramme : la source est donc sous vos yeux pendant que vous vérifiez la copie.

## Excalidraw → le canevas

**À prendre :** le fichier `.excalidraw`.

L'import le plus complet de tous, car le format d'Excalidraw est un JSON honnête avec une vraie géométrie et de vraies liaisons — `startBinding` et `endBinding` indiquent exactement quels éléments une flèche relie. Rectangles, losanges et ellipses correspondent directement à des formes, le texte lié devient des libellés, les éléments supprimés sont ignorés.

Un piège à signaler : Excalidraw exporte aussi en `.excalidraw.json`, et parfois en simple `.json`. Cette extension envoyait autrefois la scène vers l'importateur de données, et un croquis d'atelier devenait un tableur d'une seule ligne dont les cellules étaient des fragments de JSON. Le fichier est désormais reconnu grâce à sa déclaration `type: "excalidraw"` plutôt qu'à son nom, et il arrive donc sous forme de dessin, quel que soit son nom.

**Pour le retour :** Excalidraw est une cible de conversion à part entière. Les exports sont déterministes — le même diagramme produit à chaque fois une sortie identique à l'octet près, plutôt qu'un nouveau fichier à chaque export : il se prête donc aux diffs.

## draw.io / diagrams.net → le canevas

**À prendre :** le fichier `.drawio`, ou `.xml`.

Natif dans les deux sens. Les fichiers compressés sont pris en charge — draw.io écrit soit du XML mxGraph brut, soit une charge utile compressée en deflate et encodée en URI, et les deux arrivent correctement. Les fichiers écrits *en sortie* sont toujours non compressés, volontairement : un fichier brut produit un diff lisible dans une pull request, un agent peut le modifier comme du texte, et il peut être relu sans étape de décompression.

## Confluence / Sphinx / wikis internes → le canevas

**À prendre :** la source `.puml`, qui se trouve généralement déjà dans la macro de la page ou dans le dépôt.

Le vocabulaire des composants de PlantUML — `rectangle`, `card`, `usecase`, `database`, `node`, `hexagon`, `file` — se lit directement, tout comme les raccourcis `[Component]` et `(Use case)`. Les syntaxes de séquence et d'activité ne sont volontairement pas converties ; ce ne sont pas des graphes de boîtes, et les aplatir produirait quelque chose qui s'affiche et induit en erreur.

## Graphes générés → le canevas

**À prendre :** le `.dot` ou le `.gv` que votre outillage génère déjà.

Les graphes de dépendances, graphes d'appels et DAG de build sortent pour la plupart de leurs outils au format DOT. Libellés, formes, remplissages et attributs d'arêtes sont tous repris, y compris l'instruction d'attributs par défaut (`node [shape=box]`) — ce qui compte, car la valeur par défaut de Graphviz lui-même est une ellipse : un fichier qui la remplace le fait exprès.

## Outils de processus → le canevas

**À prendre :** le fichier `.bpmn`.

Le BPMN issu de Camunda, Flowable, Zeebe ou bpmn.io est lu avec ses vraies coordonnées lorsque le fichier contient la partie « diagram interchange ». Lorsqu'il ne la contient pas — ce qui est courant pour du BPMN généré par du code — le processus est mis en page à partir de ses flux de séquence au lieu d'être refusé. Un processus sans dessin reste un processus, et c'est justement le cas où le voir compte le plus.

## Quand la destination ne peut pas tout porter

Les conversions entre notations géométriques et textuelles ne sont pas toujours complètes, et le canevas vous le dit plutôt que de vous laisser le découvrir plus tard.

```bf-figure
{
  "kind": "compare",
  "title": "Deux choses qui peuvent se perdre, et ce qui se passe alors",
  "columns": [
    {
      "title": "Signalé au moment de la conversion",
      "hue": "good",
      "items": [
        "Les connexions qu'une notation textuelle ne peut pas exprimer, comptabilisées dans l'avis de résultat",
        "La mise en page, lors d'une conversion géométrie → texte (le moteur de mise en page replace tout)",
        "Le style exact au-delà du remplissage, du contour et des pointillés"
      ]
    },
    {
      "title": "Jamais supprimé en silence",
      "hue": "prove",
      "items": [
        "Une flèche dont les extrémités n'étaient que de la géométrie — reconstituée avant l'écriture",
        "Un texte qui n'appartient à aucune forme — conservé comme libellé autonome",
        "Une forme sans équivalent exact — associée à la plus proche, jamais écartée"
      ]
    }
  ],
  "caption": "Une notation textuelle ne peut dire que « A est relié à B ». Une flèche qui ne relie rien est signalée comme supprimée, chiffres à l'appui, plutôt que de disparaître discrètement."
}
```

Les trois formats en lecture seule — Visio, ArchiMate et SVG — ne sont jamais proposés comme *destination* : le menu de conversion ne peut donc pas échouer après votre clic. Il affiche exactement les notations qui fonctionneront pour l'objet sélectionné, ce qui, pour une photo, se limite à Draw.io, où elle est intégrée plutôt que de se faire passer pour des formes.

## Une migration faisable cet après-midi

```bf-figure
{
  "kind": "flow",
  "title": "Affranchir les diagrammes d'une équipe d'une licence",
  "steps": [
    { "label": "Exporter au format natif", "note": "Prenez du .vsdx / .excalidraw / .drawio partout où l'outil le propose ; du SVG sinon", "hue": "read" },
    { "label": "Les déposer sur un tableau", "note": "Chacun devient un objet diagramme modifiable, formes et connexions intactes", "hue": "prove" },
    { "label": "Convertir ce qui sera maintenu", "note": "Tout ce qui évolue avec le code devient du Mermaid — du texte, dans le dépôt, relisible dans une pull request", "hue": "build" },
    { "label": "Laisser le reste en draw.io", "note": "Les diagrammes que l'on envoie plutôt qu'on ne les maintient gardent leur mise en page exacte, dans un format que tout le monde peut ouvrir", "hue": "reach" },
    { "label": "Résilier la licence", "note": "Plus rien sur le tableau n'a besoin de l'outil d'origine pour s'ouvrir", "hue": "expand" }
  ]
}
```

La répartition entre les étapes trois et quatre est celle qui compte. Les diagrammes qui décrivent un système en mouvement devraient être du texte, car un schéma d'architecture est périmé le lendemain de sa création sans que personne ne s'en aperçoive. Les diagrammes destinés à être remis à quelqu'un devraient être en draw.io, car la mise en page est le message et le fait que tout le monde puisse l'ouvrir est tout l'intérêt.

À lire aussi : [Tous les formats de diagramme que le canevas lit et écrit](/blog/every-diagram-format-the-canvas-reads) pour la référence complète des notations, et [Quel diagramme dessiner ?](/blog/which-diagram-should-you-draw) pour choisir le type avant l'outil.

[Ouvrez un canevas et déposez-y un fichier →](/create/new)
