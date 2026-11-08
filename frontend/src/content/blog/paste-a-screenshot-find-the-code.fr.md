# Collez une capture d’écran, trouvez le code qui se cache derrière

Une revue reste bloquée sur « Judging ». Vous le voyez. Vous pouvez en faire une capture d’écran. Et vous n’avez aucune idée de savoir lequel de quatre mille fichiers en est responsable.

C’est cet écart. Le symptôme vit sur un écran et la cause vit dans une base de code, et rien ne les relie, sinon la personne qui se trouve s’en souvenir. On se tourne donc vers un graphe, le graphe dessine chaque fichier comme un point, et les points ne vous disent rien. Une image de milliers de nœuds n’est pas une réponse à « où cela mène-t-il ? ». C’est le même mur de fichiers avec un arrière-plan plus joli.

## Une seule carte, dessinée comme un réseau de transport

La vue des connaissances montre désormais une base de code comme une ville montre ses trains : des **lignes**. Chaque ligne part d’un point d’entrée — une route, un écran ou une tâche —, traverse les couches qu’elle emprunte et se termine aux stockages et aux services externes qu’elle touche. Vous lisez un chemin au lieu d’un tas.

```bf-figure
{
  "kind": "screen",
  "frame": "La vue des connaissances, sous forme de carte",
  "ratio": 1.62,
  "regions": [
    { "label": "Barre de questions", "note": "Tapez une question, ou collez une capture d’écran", "x": 4, "y": 6, "w": 92, "h": 9, "hue": "idea" },
    { "label": "Lignes depuis chaque point d’entrée", "note": "Points d’entrée, à travers les couches, jusqu’aux stockages et aux services externes", "x": 4, "y": 19, "w": 62, "h": 60, "hue": "make" },
    { "label": "Ce que cela montre", "note": "Les constats sur le chemin que vous avez sélectionné", "x": 69, "y": 19, "w": 27, "h": 60, "hue": "measure" },
    { "label": "Vues", "note": "Carte, Système, Graphe, Carte mentale, Tour 3D, Chaleur, Liste, Séquence", "x": 4, "y": 84, "w": 46, "h": 10, "hue": "accent" },
    { "label": "Surcouches", "note": "N’importe quelle mesure peut piloter la couleur, la taille, l’anneau, l’épaisseur de ligne ou la pulsation", "x": 53, "y": 84, "w": 43, "h": 10, "hue": "accent" }
  ],
  "caption": "Une seule surface. La même base de code peut se lire comme une carte, un système en N niveaux, un graphe, une carte mentale, une tour 3D, une carte de chaleur, une liste ou une séquence, sans repartir de zéro."
}
```

Vous pouvez poser des questions au lieu de choisir des perspectives. **Où cela mène-t-il ?** **Qu’est-ce qui ne va pas ?** **Qu’est-ce qui n’a pas de test ?** **Quels motifs sont présents ?** **Qu’est-ce qui a changé ?** Chaque question règle pour vous la vue et la surcouche : la réponse est la première chose à l’écran.

## Collez la capture d’écran

C’est la partie qui change l’après-midi. Déposez la capture d’écran dans la barre de questions. Un modèle de vision lit le texte qui y est visible. Puis la recherche ordinaire prend le relais : elle fait correspondre ce texte à vos catalogues de traduction et à votre code source, trouve les fichiers et va un import plus loin. La vue se filtre sur le code qui se cache derrière ce que vous avez vu.

```bf-figure
{
  "kind": "flow",
  "title": "D’un écran bloqué aux fichiers qui se cachent derrière",
  "steps": [
    { "label": "Coller", "note": "Une capture d’écran de la revue bloquée sur Judging va dans la barre de questions.", "hue": "idea" },
    { "label": "Lire", "note": "Un modèle de vision lit les mots visibles. Rien d’autre n’est deviné.", "hue": "idea" },
    { "label": "Rapprocher", "note": "La recherche fait correspondre ces mots, via les catalogues de traduction et le code source, à des fichiers, et à un saut d’import de plus.", "hue": "make" },
    { "label": "Étiqueter", "note": "Chaque correspondance indique comment elle a été trouvée : exacte, catalogue ou import.", "hue": "make", "tag": "vous pouvez en juger" },
    { "label": "Diagnostiquer", "note": "Remettez le chemin et ses constats à l’agent, qui travaille avec ses propres outils.", "hue": "run" }
  ],
  "caption": "Le rapprochement est une recherche déterministe, pas l’opinion d’un modèle. Le modèle ne fait que lire les pixels, et chaque correspondance vous dit pourquoi elle figure dans la liste."
}
```

Cet étiquetage est l’essentiel. Une correspondance **exacte** est la chaîne elle-même trouvée dans le code. Une correspondance **catalogue** est passée par les fichiers de traduction, la manière habituelle dont un mot à l’écran n’est pas un mot du code source. Une correspondance **import** est un voisin, à un saut de distance. Vous pouvez distinguer une correspondance certaine d’une correspondance plausible avant d’y consacrer une minute.

Ensuite, **Diagnostiquer avec l’agent** transmet le chemin et tout ce que la carte sait déjà à son sujet. L’agent ne part pas d’une page blanche et d’une zone de recherche.

## Voir ce qui ne va pas, pas seulement ce qui existe

Les surcouches transforment une mesure en canal visuel, et n’importe quelle mesure peut piloter n’importe quel canal.

```bf-figure
{
  "kind": "compare",
  "title": "Un graphe de points, et une carte sur laquelle on peut agir",
  "columns": [
    { "title": "Un graphe de tout", "hue": "muted", "items": ["Des milliers de nœuds", "La couleur signifie ce que la légende dit cette semaine", "Vous donne la forme, pas le problème", "Vous cherchez toujours les fichiers à la main"] },
    { "title": "La carte", "hue": "make", "items": ["Une ligne par point d’entrée : vous lisez un chemin", "Anti-motifs, complexité, couverture, usage, rotation du code, ce qui a changé et responsable, chacun sous forme de couleur, de taille, d’anneau, d’épaisseur de ligne ou de pulsation", "Des questions qui règlent la vue pour vous", "Une capture d’écran qui la réduit au code derrière un symptôme"] }
  ],
  "caption": "La même base de code. La différence tient à ce que l’image réponde à une question ou prouve seulement que la base de code est grande."
}
```

Autour de la carte se trouvent les panneaux dont vous aurez besoin ensuite :

- **Synchronisation** montre ce qui se trouve sur votre machine par rapport à ce que le serveur possède, et quels fichiers ont été ignorés et pourquoi : un trou dans la carte n’est donc jamais un mystère.
- **Couverture** montre ce qui n’a pas de test.
- **Motifs** liste les anti-motifs du code et où ils se regroupent.
- **API** transforme vos routes en squelette OpenAPI ou en export Postman.
- **File de correctifs** applique un correctif déterministe pour le code inutilisé et, sinon, rédige un prompt pour l’agent.
- **Simuler** fait écrire et exécuter par l’agent un test qui parcourt un chemin avec les valeurs de votre choix, de sorte que « cela mène-t-il vraiment là ? » obtient une vraie réponse.

## Sa place dans la méthode

[De l’idée au réel](/blog/idea-to-real-the-operating-methodology) va de l’Idée à Réaliser, Exécuter et Mesurer. Cette capacité concerne les actes qui décident s’il faut dépenser, et celui qui dépense.

**Elle fait fonctionner Lire sur du code que vous avez déjà.** [Lire](/blog/read-prove-build-the-inner-loop) demande ce qui est réellement là, et il doit être gratuit. Pour un système en production, « ce qui est réellement là » signifiait autrefois des heures dans les fichiers. La carte et la barre de questions en font quelques minutes, sans dépense d’agent tant que vous ne le choisissez pas.

**Elle rend Construire moins cher en le resserrant.** Construire est l’acte qui coûte, et une construction visant les mauvais fichiers est la plus coûteuse de toutes. Une capture d’écran qui amène l’agent sur le bon chemin, constats joints, signifie que l’argent va à la modification et non à la recherche de l’endroit où elle doit se faire.

**Elle aide aussi Exécuter et Mesurer.** Dans Exécuter, un symptôme sur un écran en production devient un chemin. Dans Mesurer, les mêmes surcouches montrent ce qui a changé et ce qui n’a pas de test : vous voyez où le système a bougé, et pas seulement qu’il a bougé.

## Ce que vous pouvez en faire dès aujourd’hui

- **Coller une capture d’écran d’un bug** et voir les fichiers qui se cachent derrière, chacun étiqueté selon la manière dont il a été trouvé.
- **Demander où va une requête**, de son point d’entrée à travers les couches jusqu’aux stockages et services du bout de la chaîne.
- **Demander ce qui ne va pas, ce qui n’a pas de test et ce qui a changé**, et obtenir la vue qui y répond.
- **Passer entre huit vues** de la même base de code sans perdre sa place.
- **Exporter votre API** sous forme de squelette OpenAPI ou de collection Postman à partir des routes déjà trouvées.
- **Faire le ménage dans le code inutilisé** avec un correctif déterministe, et confier tout le reste à l’agent sous forme de prompt prêt à l’emploi.
- **Simuler un chemin** avec vos propres valeurs avant de lui faire confiance.

---

**À lire aussi :** [Pointez-le vers un dossier et voyez ce qu’il sait](/blog/point-it-at-a-folder-and-see-what-it-knows) · [Lire, Prouver, Construire : la boucle intérieure](/blog/read-prove-build-the-inner-loop) · [Qualité, erreurs et correctifs en un clic](/blog/quality-error-observability-one-click-fix)

[Ouvrez un canevas](/create), pointez-le vers un dossier et collez la capture d’écran que vous fixez depuis tout à l’heure.
