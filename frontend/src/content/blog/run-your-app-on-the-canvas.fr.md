Demandez un envoi de SMS et quatre cartes arrivent sur le tableau : `backend/server.js`, `frontend/index.html`, une page rendue, une note de configuration. Toutes reliées, toutes correctes, toutes posées là.

Et ensuite ?

Pendant un temps, la réponse honnête était : rien, sur cet écran. Le tableau pouvait décrire une application dans ses moindres détails, sans aucun moyen d'en exécuter une. Le seul chemin vers une URL en ligne passait par un inspecteur de carte, derrière une action de publication présentée comme une démarche commerciale — à trois clics de profondeur, et invisible tant que vous n'aviez pas sélectionné exactement la bonne carte. Un canevas capable de construire un logiciel mais pas de l'exécuter n'est qu'un très bon carnet de notes.

## La surface app

Il existe désormais une quatrième façon de lire un tableau, aux côtés de la conversation, du graphe et de l'espace 3D : **l'app**.

```bf-figure
{
  "kind": "flow",
  "title": "Ce qui se passe quand vous passez à la surface app",
  "steps": [
    { "label": "Rassembler", "note": "Chaque carte de code du tableau devient un fichier. Pas seulement celle qui est sélectionnée — toutes, dans la structure qu'elles décrivent.", "hue": "make" },
    { "label": "Assembler", "note": "La page d'entrée est identifiée, et ses feuilles de style et scripts voisins sont intégrés en ligne pour que l'aperçu ait de quoi les résoudre.", "hue": "make" },
    { "label": "Exécuter", "note": "Un seul document fonctionnel, cadré à une vraie largeur d'appareil, avec les erreurs de build et d'exécution renvoyées à l'assistant qui l'a écrit.", "hue": "make", "tag": "sur le tableau" }
  ],
  "caption": "La surface lit toute la session, pas une seule carte. Une application répartie sur six cartes forme un seul artefact — ce que rien sur le tableau ne pouvait exprimer jusqu'ici."
}
```

Deux aspects étaient plus difficiles qu'il n'y paraît.

```bf-figure
{
  "kind": "screen",
  "frame": "Un tableau lu comme une app",
  "ratio": 1.62,
  "regions": [
    { "label": "L'application en cours d'exécution", "note": "Chaque carte de code du tableau, assemblée et servie comme un seul document", "x": 4, "y": 8, "w": 62, "h": 74, "hue": "make" },
    { "label": "Brain", "note": "Demande la modification, voit l'erreur", "x": 69, "y": 8, "w": 27, "h": 74, "hue": "idea" },
    { "label": "Sélecteur de surface", "x": 4, "y": 88, "w": 30, "h": 8, "hue": "accent" },
    { "label": "Exécuter · largeurs · partager", "x": 38, "y": 88, "w": 58, "h": 8, "hue": "accent" }
  ],
  "caption": "Une seule barre de commandes pour tout le canevas, pas une par environnement d'exécution. La surface app ajoute Exécuter et les trois largeurs DANS cette barre au lieu d'en dessiner une seconde en dessous."
}
```

**Un aperçu a besoin d'une origine.** Un document confié à un cadre n'a pas d'adresse, donc `href="styles.css"` ne se résout par rapport à rien et vous obtenez une page d'apparence correcte, privée de tous ses styles — le classique « pourquoi l'aperçu a l'air cassé alors que le code est bon ». C'est précisément pour cela que la surface intègre en ligne les fichiers voisins.

**Les largeurs d'appareil ne sont pas un max-width.** Ordinateur, tablette et téléphone étaient autrefois trois boutons qui ne changeaient rien de visible, car on demandait au cadre à la fois d'avoir une certaine largeur et de remplir l'espace — et c'est le remplissage qui gagnait. Pire : même là où un plafond s'appliquait, plafonner un document lui transmet la largeur *la plus petite* ; ses propres media queries se déclenchent donc pour le cadre, et votre lecture « ordinateur » affiche la version mobile repliée. Les trois réglages mettent désormais le document en page à 1280, 834 et 390 pixels CSS réels, puis mettent le résultat à l'échelle dans le cadre. Ils diffèrent comme trois vraies machines diffèrent, parce que c'est désormais ce qu'ils sont.

```bf-figure
{
  "kind": "devices",
  "title": "Trois lectures, à trois vraies largeurs",
  "devices": [
    { "label": "Ordinateur", "width": 1280, "hue": "make", "note": "Le document est mis en page à 1280 puis mis à l'échelle dans le cadre" },
    { "label": "Tablette", "width": 834, "hue": "run", "note": "Ses propres media queries se déclenchent pour 834, pas pour le cadre" },
    { "label": "Téléphone", "width": 390, "hue": "measure", "note": "La version mobile repliée que vous livrez réellement" }
  ],
  "caption": "Largeurs à l'échelle : la part de chaque cadre dans la rangée correspond à sa largeur divisée par leur somme. Un cadre plafonné transmet au document la largeur la PLUS PETITE, ce qui explique pourquoi l'ancienne lecture Ordinateur affichait la mise en page mobile."
}
```

## Le défaut sous-jacent

En construisant cela, nous avons découvert quelque chose qui mérite d'être dit à voix haute, car cela coûtait en silence des sessions entières.

La surface app lisait le code source d'une carte de code dans un champ. L'assistant l'écrit dans un autre — celui que porte son propre outil, et le premier que lit l'aperçu de la carte. Résultat : chaque carte de code rédigée par l'assistant paraissait parfaite sur le tableau et n'apportait **rien** à l'app. Aucune erreur, aucun avertissement, aucun état vide qui s'explique : juste « Rien à exécuter pour l'instant » sous un tableau rempli de code.

Un second défaut se trouvait juste à côté. Chaque lecture et écriture de fichier de l'espace de travail demandait au serveur un chemin vide, à cause d'un détail de routage qui renvoie `undefined` pour la partie de l'URL portant le nom du fichier. Un canevas pouvait créer un projet sans jamais y écrire une seule ligne de code — quatre appels d'outil en échec d'affilée, et un tour qui se terminait sur un haussement d'épaules.

Les deux sont corrigés. Nous les mentionnons parce qu'une annonce de fonctionnalité qui ne liste que des nouveautés est un document marketing ; si la surface app fonctionne aujourd'hui, c'est autant grâce à ces deux corrections qu'à la surface elle-même.

## Sa place dans la méthode

Créer est le troisième acte, et le plus coûteux. [Lire et Prouver](/blog/read-prove-build-the-inner-loop) viennent d'abord et ne coûtent rien, précisément pour que la décision de construire soit une décision. Mais une fois que vous construisez, la boucle entre *modifier quelque chose* et *le voir* est toute l'expérience — et chaque sortie de cette boucle, vers un terminal, un déploiement, une URL d'aperçu, un autre onglet, est un endroit où l'attention se perd.

```bf-figure
{
  "kind": "compare",
  "title": "La distance entre la modification et la preuve",
  "columns": [
    { "title": "La boucle habituelle", "hue": "muted", "items": ["Modifier dans l'éditeur", "Enregistrer", "Attendre un build", "Passer au navigateur", "Actualiser", "Découvrir que les styles ne se sont pas chargés", "Deviner pourquoi"] },
    { "title": "Sur le tableau", "hue": "make", "items": ["Demander la modification", "Regarder les cartes se mettre à jour", "La lire à la largeur voulue", "Les erreurs retournent à l'assistant qui les a écrites"] }
  ],
  "caption": "Les erreurs de build et d'exécution remontent désormais à l'agent : un build cassé devient quelque chose qu'on corrige, plutôt que quelque chose qui reste là en ayant l'air terminé."
}
```

## Ce que vous pouvez en faire dès aujourd'hui

- **Décrire une application et l'exécuter dans la même minute** — le backend, la page et les ressources s'assemblent en un seul objet sur lequel cliquer.
- **La lire à trois vraies largeurs** avant que quiconque ne l'ouvre sur un téléphone.
- **La transformer en projet** quand elle cesse d'être une ébauche : un bouton donne au tableau son propre environnement d'exécution, ses propres données, ses propres membres et sa propre adresse web — une adresse choisie dès le départ plutôt que découverte au moment de publier.
- **La packager** en application web installable, en build Android ou en build iOS signé — ce qui est livré dans le paquet est exactement ce que vous avez prévisualisé.

Rien de tout cela n'exige de quitter le tableau, et c'est tout l'intérêt. Le tableau n'est pas un artefact de planification qui précède le vrai travail. C'est là que le travail se fait.

---

**À lire aussi :** [Le Canvas de création n'est pas une fenêtre de chat](/blog/creation-canvas-beyond-chat) · [Créez avant de vous inscrire](/blog/create-before-you-sign-up) · [Concevoir, construire, déboguer — un seul espace de travail spatial](/blog/design-build-debug-one-spatial-workspace)

[Ouvrez un canevas](/create) et demandez quelque chose qui comporte un backend.
