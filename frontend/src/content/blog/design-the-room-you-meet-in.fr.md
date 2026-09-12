Les équipes ne se réunissent pas dans une seule salle.

La revue avec la direction se tient autour d'une longue table avec un écran au bout. La rétro du vendredi se tient dans la cuisine, perchés sur des tabourets autour de l'îlot. Le sprint se tient dans l'open space, un bureau chacun, un tableau blanc sur le mur du fond. La salle fait partie de ce qu'*est* la réunion : qui est assis en face de qui, ce qui est au mur, si l'on est debout ou accoudé.

La salle de votre board était une seule salle : une table ronde, un cercle de personnes, un mur au fond. C'était la bonne première salle. C'était aussi la seule, on ne pouvait la regarder que d'en haut, et un jeu créé par votre canvas se jouait tout à fait ailleurs.

## Choisir la salle

Appuyez sur **Aménager** dans la salle : la première chose proposée, c'est l'endroit où cette session se réunit.

```bf-figure
{
  "kind": "screen",
  "frame": "La salle, en mode Aménager",
  "ratio": 1.62,
  "regions": [
    { "label": "La salle", "note": "Glissez n'importe quel élément pour le déplacer. R le tourne, Suppr le retire. Tout le monde dans la session voit chaque modification dès qu'elle arrive.", "x": 4, "y": 8, "w": 64, "h": 76, "hue": "make" },
    { "label": "Cette salle", "note": "Places, éléments et surface d'abord — parce que « est-ce qu'on tient tous ? » est la première question qu'on se pose sur une salle", "x": 71, "y": 8, "w": 25, "h": 14, "hue": "accent" },
    { "label": "Partir de", "note": "Salle de standup · Salle du conseil · Cuisine de bureau · Open space", "x": 71, "y": 25, "w": 25, "h": 14, "hue": "idea" },
    { "label": "Ajouter du mobilier", "note": "Tables, bureaux, chaises, canapés, cloisons, écrans, plantes — ou importez votre propre modèle", "x": 71, "y": 42, "w": 25, "h": 22, "hue": "make" },
    { "label": "Partager cette salle", "note": "La vendre, la télécharger ou importer celle que quelqu'un vous a envoyée", "x": 71, "y": 67, "w": 25, "h": 17, "hue": "measure" },
    { "label": "Regarder · Marcher · Aménager", "x": 4, "y": 88, "w": 40, "h": 8, "hue": "accent" }
  ],
  "caption": "L'aménageur remplace la liste des participants pendant que vous aménagez et la rend quand vous arrêtez. Il n'apparaît que pour les personnes qui peuvent modifier le board — les autres voient simplement la salle changer."
}
```

Une **salle du conseil**, c'est une longue table avec cinq chaises de chaque côté, un écran au mur du fond et un tableau blanc sur le côté. Une **cuisine de bureau**, c'est un comptoir et un réfrigérateur le long du fond, un îlot avec six tabourets et un canapé dans le coin où ont lieu les vraies conversations. Un **open space**, ce sont neuf postes — un bureau, une chaise, une cloison — sur trois rangées, avec un tableau blanc à l'avant.

Chacune est un point de départ, pas un modèle auquel vous êtes condamné. Déplacez une chaise, et c'est votre salle.

## L'aménager vous-même

Le mobilier est un vrai mobilier, au sens qui compte : il a une emprise au sol, une hauteur, et **les chaises font asseoir des gens.** La première personne de la session prend la première chaise que vous avez placée, la deuxième la suivante, et tous ceux qui arrivent après la dernière chaise se tiennent en cercle autour de la salle plutôt qu'au milieu d'une table. Un canapé accueille deux personnes.

Ce qui se fixe au mur se comporte comme tel. Faites glisser un écran sur le sol et il passe d'un mur à l'autre en se tournant vers la salle ; il ne finit jamais posé sur la moquette. Les écrans, tableaux blancs et affiches acceptent une image — importez-la ou collez un lien —, si bien que l'écran de la salle du conseil affiche le graphique du trimestre et que l'affiche de la cuisine affiche ce qu'affiche l'affiche de la cuisine de votre équipe.

Et quand le meuble que vous voulez n'est pas dans la liste, **importez-le.** STL, OBJ, glTF, GLB ou STEP : les mêmes formats qu'une impression 3D sur le canvas lit déjà. Il prend place dans la salle à une taille raisonnable, et vous l'étirez à partir de là.

Un aménagement de salle est un objet de votre board, comme tout ce qui s'y trouve. Il s'enregistre donc automatiquement, s'annule, les collaborateurs le voient changer, et Brain peut le modifier en une phrase — *« transforme la salle en cuisine »*, c'est une modification d'un objet. Un board peut contenir plusieurs salles ; **Se réunir ici** décide dans laquelle se trouve la session.

## La parcourir

**Regarder**, c'est la salle telle qu'elle a toujours été : tourner autour, zoomer, déplacer ce qui est sur la table. **Marcher** vous y fait entrer.

```bf-figure
{
  "kind": "flow",
  "title": "Trois façons d'être dans la salle",
  "steps": [
    { "label": "Regarder", "note": "Tournez autour de la salle vue d'en haut et déplacez ce qui s'y trouve — le diorama, les créations, les stations.", "hue": "idea" },
    { "label": "Marcher", "note": "ZQSD/WASD ou les flèches pour avancer, Espace pour sauter, glisser pour regarder, V pour la première ou la troisième personne. Chaque mur et chaque meuble sont solides.", "hue": "make", "tag": "comme dans Roblox" },
    { "label": "Jouer", "note": "Approchez-vous d'un lieu Roblox sur son socle et appuyez sur Jouer : son niveau se charge ici même, et un bouton vous ramène.", "hue": "run", "tag": "dans la salle" }
  ],
  "caption": "Sur téléphone, le personnage dispose d'une croix directionnelle à l'écran et d'un doigt pour regarder. Tous les autres membres de la session sont dessinés là où ils se trouvent vraiment, et marchent avec vous."
}
```

C'est cette dernière phrase qui change la raison d'être de la salle. Quand vous marchez, tous les autres vous voient marcher — jusqu'au tableau blanc, autour de l'îlot, vers l'écran. Une salle où les gens bougent est une salle où l'on peut aller se placer à côté de ce dont on veut parler.

## Roblox, dans la salle

Un lieu Roblox généré par votre canvas, c'était jusqu'ici quelque chose qu'on téléchargeait pour l'ouvrir dans Roblox Studio. Il se dresse désormais dans la salle sur un socle, avec une miniature de son niveau au sommet — et appuyer sur **Jouer** vous plonge dans ce niveau, sur la scène de la salle, avec le même personnage et la même caméra. Ses objets à collecter comptent, ses dangers blessent, son objectif termine la partie.

Tous ceux de la session qui appuient sur Jouer sur le même lieu sont ensemble dans le même niveau, et personne de ceux restés dans la salle n'y est. Un bouton vous ramène dans la salle, exactement là où vous l'aviez quittée.

Soyons précis sur ce qui s'exécute. Les pièces du niveau, ses objets à collecter, ses dangers et son objectif sont lus depuis le fichier du lieu et joués ici. Ses **scripts Luau** s'exécutent sur les serveurs de Roblox et nulle part ailleurs, et le bandeau au-dessus du niveau le dit plutôt que de laisser une porte scriptée avoir l'air cassée.

## La partager

Une salle que vous avez aménagée est quelque chose qu'une autre équipe utiliserait — donc quelque chose que vous pouvez vendre.

```bf-figure
{
  "kind": "flow",
  "title": "D'une salle que vous avez créée à une salle où se réunit une autre équipe",
  "steps": [
    { "label": "Aménager", "note": "Aménagez la salle sur votre propre board, ou partez d'un modèle et faites-en le vôtre.", "hue": "make" },
    { "label": "Stage", "note": "Parcourue avant d'être publiée : chaque élément dans les murs, chaque place comptée, de quoi se tenir debout si elle n'assoit personne.", "hue": "measure", "tag": "vérifiée" },
    { "label": "Publier", "note": "Une offre de Salle sur la marketplace, gratuite ou payante, avec un aperçu que l'acheteur peut parcourir d'abord.", "hue": "run" },
    { "label": "Installer", "note": "L'acheteur reçoit une copie de la salle sur son board et s'y réunit la prochaine fois qu'il ouvre la Salle.", "hue": "run" }
  ],
  "caption": "Un modèle inchangé peut être publié, mais Stage le signale : chaque session a déjà la salle du conseil. Une offre vaut davantage une fois qu'elle est une salle à part entière."
}
```

Si vous préférez la transmettre directement, **Télécharger l'aménagement** vous donne la salle sous forme de fichier, et **Importer un aménagement** transforme le fichier de quelqu'un d'autre en votre salle — images et modèles compris, par lien.

## Sa place dans la méthode

Read → Prove → Build dit que les deux premiers actes sont gratuits précisément pour que le troisième, le coûteux, soit une décision et non une habitude. La salle avait déjà rendu spatial l'un de ces actes gratuits : le standup, l'atelier, la rétro, tenus sur le travail plutôt qu'à côté. Pouvoir l'aménager élargit *quel* acte gratuit vous pouvez y tenir.

```bf-figure
{
  "kind": "compare",
  "title": "La même session, dans la salle qu'il lui fallait",
  "columns": [
    { "title": "Une salle pour tout", "hue": "muted", "items": ["Une table ronde pour la revue avec la direction", "Une table ronde pour la rétro", "Une table ronde pour la planification du sprint", "Regarder la salle d'en haut", "Jouer au jeu ailleurs"] },
    { "title": "La salle qui est la réunion", "hue": "make", "items": ["Une salle du conseil avec le trimestre à l'écran", "Une cuisine pour la rétro", "Un open space pour le sprint", "Marcher jusqu'à ce dont on veut parler", "Tester le niveau ensemble, dans la salle"] }
  ],
  "caption": "La salle est toujours proposée dès Idea. Ce qui change, c'est qu'elle peut prendre la forme de la conversation que vous êtes sur le point d'avoir."
}
```

Là où elle change le plus :

- **Idea** — l'atelier obtient une salle faite pour un atelier : un long mur, un tableau blanc, de la place pour prendre du recul.
- **Make** — pour un jeu, **Prove** voulait dire livrer une build et demander aux gens de l'essayer plus tard. Désormais, ceux qui ont demandé le niveau le parcourent avec vous, dans la même salle, pendant qu'il se construit. C'est la preuve la moins chère qu'un jeu puisse obtenir, et la plus honnête.
- **Run** — une salle aménagée est quelque chose que vous avez fait et qui fonctionne ailleurs : installée sur le board d'une autre équipe, soumise aux vérifications de Stage à la sortie. Une salle est désormais quelque chose que vous pouvez vendre, pas seulement un endroit où vous tenir.

## Ce que vous pouvez en faire dès aujourd'hui

- **Choisir où se réunit votre session** — une salle du conseil, une cuisine de bureau ou un open space — en un clic.
- **Aménager une salle à vous** : glisser, tourner et étirer le mobilier, accrocher des images aux murs, importer vos propres modèles 3D.
- **Parcourir la salle comme un jeu**, au clavier ou au toucher, pendant que tous les autres membres de la session la parcourent aussi.
- **Jouer à votre lieu Roblox dans la salle**, ensemble, et en ressortir sans quitter le board.
- **Vendre la salle sur la marketplace**, ou l'envoyer à quelqu'un sous forme de fichier.

Ouvrez une session, appuyez sur **Salle**, puis sur **Aménager**.

---

**À lire aussi :** [Stand up inside your board](/blog/stand-up-inside-your-board) · [Build a 3D world in the browser](/blog/build-a-3d-world-in-the-browser) · [Run the app your board just built](/blog/run-your-app-on-the-canvas)
