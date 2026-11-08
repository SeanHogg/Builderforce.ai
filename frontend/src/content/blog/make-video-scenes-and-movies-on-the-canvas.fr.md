# Décrivez une histoire, obtenez un film — la vidéo sur le canevas

Le canevas savait déjà produire les parties fixes d’un lancement : la page, le texte, les images, la présentation. Il ne pouvait pas produire la partie que les gens regardent vraiment.

Demandez « une publicité de 30 secondes pour la boulangerie » et vous obteniez un storyboard : un joli tableau de plans, chacun avec la description d’un clip qui n’existait pas. Le transformer en vidéo signifiait repartir avec le tableau, trouver un outil vidéo, générer les plans un par un, les télécharger et les monter ensemble ailleurs. La plupart des idées mouraient à ce stade, et la plupart restaient à l’état de storyboards.

Désormais, le storyboard se rend.

## Un clip, une scène, un film

La plus petite unité est un **clip**. Décrivez un plan, par exemple *de la vapeur qui s’élève d’un pain sur une grille de refroidissement, lent travelling avant, lumière du matin*, et quelques minutes plus tard un vrai clip vidéo se trouve sur le tableau, en paysage, vertical ou carré.

L’unité supérieure est une **scène**. Décrivez une histoire, et le canevas la planifie comme le ferait un réalisateur : qui y participe, ce qui se passe et comment la caméra le voit, découpé en plans. Chaque plan est ensuite rendu comme son propre clip, côte à côte.

```bf-figure
{
  "kind": "flow",
  "title": "D’une phrase à un montage",
  "steps": [
    { "label": "Planifier", "note": "L’histoire devient une liste de plans : action, caméra et durée pour chaque plan, avec des personnages cohérents d’un plan à l’autre.", "hue": "idea" },
    { "label": "Rendre", "note": "Chaque plan est rendu comme un vrai clip vidéo, plusieurs à la fois. Un plan qui échoue en indique la raison, et les autres continuent.", "hue": "make" },
    { "label": "Monter", "note": "Les plans rendus sont mis dans l’ordre sur une chronologie vidéo, prêts pour la musique, la narration et les sous-titres.", "hue": "make", "tag": "sur le tableau" },
    { "label": "Exporter", "note": "Téléchargez le film depuis votre navigateur, ou, avec Pro et Teams, faites-le rendre sur nos serveurs et fermez l’onglet.", "hue": "run" }
  ],
  "caption": "Une seule demande vous mène de l’idée au montage. Brain effectue chaque étape à partir d’une seule phrase, et vous pouvez intervenir à n’importe laquelle."
}
```

La liste de plans reste sur le tableau comme un objet à part entière, ce qui compte dès la première fois que quelque chose cloche un peu. Si le chien du troisième plan regarde du mauvais côté, réécrivez ce plan et refaites le rendu. Seul ce plan est régénéré, et les autres plans conservent les clips que vous aviez déjà aimés.

```bf-figure
{
  "kind": "screen",
  "frame": "Une scène sur le canevas",
  "ratio": 1.62,
  "regions": [
    { "label": "L’histoire", "note": "Un prompt, une forme et une durée", "x": 4, "y": 8, "w": 34, "h": 40, "hue": "idea" },
    { "label": "Planifier · Rendre · Faire le film", "x": 4, "y": 52, "w": 34, "h": 12, "hue": "accent" },
    { "label": "Liste de plans", "note": "Le prompt, la durée et le clip de chaque plan ; réécrivez-en un et ne refaites le rendu que de celui-là", "x": 42, "y": 8, "w": 54, "h": 74, "hue": "make" },
    { "label": "Cloud ou cet appareil", "x": 4, "y": 88, "w": 34, "h": 8, "hue": "muted" }
  ],
  "caption": "La vidéo dans le cloud utilise des modèles hébergés et votre quota vidéo quotidien. Le moteur sur l’appareil fonctionne toujours aussi, gratuitement et en privé dans votre navigateur."
}
```

## Le montage est une vidéo ordinaire

Faire un film ne l’enferme pas dans un générateur. Le montage arrive sur le tableau comme un objet vidéo normal, dans le même éditeur de chronologie que celui que vous utilisez pour les enregistrements d’écran et les images importées. Ajoutez un fond musical, enregistrez une voix off, rédigez des sous-titres, rognez un plan, déplacez les chapitres. Puis exportez-le, ou publiez-le directement sur YouTube depuis la même carte.

L’export s’exécute dans votre navigateur avec tous les forfaits. Avec Pro et Teams, vous pouvez aussi **effectuer le rendu sur le serveur**. Le film est rendu sur nos machines : vous pouvez fermer l’onglet, et le MP4 terminé vous attend sur la carte à votre retour.

## De la vidéo dans les applications que Studio construit

Le même générateur fonctionne désormais dans Studio. Demandez « une page d’atterrissage avec une vidéo en boucle en en-tête » et l’agent crée le clip, l’enregistre dans votre espace de travail et écrit son lien permanent dans la balise `<video>`. Vous obtenez une vraie boucle d’arrière-plan, pas un lien vers une vidéo d’exemple qui cesse de fonctionner à la publication.

```bf-figure
{
  "kind": "compare",
  "title": "Demander de la vidéo, avant et après",
  "columns": [
    { "title": "Avant", "hue": "muted", "items": ["Un tableau de storyboard avec des plans qui n’existent pas", "Un lien vers une vidéo d’exemple en en-tête qui casse à la publication", "Cinq outils et un après-midi pour transformer un script en montage"] },
    { "title": "Maintenant", "hue": "make", "items": ["De vrais clips pour chaque plan, rendus sur le tableau", "Une boucle d’en-tête générée et stockée avec l’application", "Une phrase pour un film que vous pouvez modifier, exporter ou publier"] }
  ],
  "caption": "La différence n’est pas une meilleure description d’une vidéo. Vous obtenez la vidéo."
}
```

## Sa place dans la méthode

Le travail sur Builderforce suit un arc, **Idée → Réaliser → Exécuter → Mesurer**, et chaque acte passe par la même boucle intérieure : [Lire, Prouver, Construire](/blog/read-prove-build-the-inner-loop).

La vidéo relève de **Réaliser**, mais elle porte ses fruits à l’étape **Prouver**. Beaucoup d’idées ne deviennent crédibles qu’une fois qu’elles bougent : une publicité, une démonstration de produit, les trente premières secondes d’une présentation, un teaser vertical pour la semaine de lancement. Un storyboard demande aux personnes à qui vous voulez le prouver d’imaginer le film. Un montage brut leur permet d’y réagir. « Cliqueriez-vous sur ceci ? » est une question que vous pouvez désormais poser avec la vraie vidéo devant quelqu’un, le jour même où l’idée est venue.

Elle garde aussi **Construire** honnête. Chaque plan est un objet distinct, qui peut être rendu à nouveau, et le montage est une chronologie ordinaire : itérer signifie donc modifier un plan ou une coupe, pas tout recommencer. Quand le montage est terminé, il passe à **Exécuter** comme boucle d’en-tête d’une page, comme envoi sur YouTube ou comme ressource de campagne, sans quitter le tableau.

## Ce que vous pouvez en faire dès aujourd’hui

- **Créer un clip à partir d’une phrase**, en paysage, vertical ou carré.
- **Transformer une histoire en court film** : planifié en plans, chaque plan rendu, monté ensemble sur une chronologie.
- **Corriger un plan sans refaire le reste** : réécrivez-le et ne refaites le rendu que de ce plan.
- **Le finaliser comme n’importe quelle vidéo** : musique, narration, sous-titres et coupes, puis exporter, faire le rendu sur le serveur (Pro et Teams) ou publier sur YouTube.
- **Demander à Brain le tout en une ligne**, ou demander à Studio une vidéo d’en-tête dans l’application qu’il construit.

---

**À lire aussi :** [Studio crée les images dont votre application a besoin](/blog/studio-makes-the-images-your-app-needs) · [Exécutez l’application que votre tableau vient de construire](/blog/run-your-app-on-the-canvas) · [Le Creation Canvas n’est pas une fenêtre de discussion](/blog/creation-canvas-beyond-chat)

[Ouvrez un canevas](/create) et demandez une publicité de trente secondes.
