# Construisez un monde 3D dans le navigateur — et promenez-vous-y

Le Creation Canvas propose depuis un moment une vue 3D. C’était une lecture du tableau à plat : vos cartes, disposées dans l’espace, agréables à survoler, mais une vue plutôt qu’un lieu. Rien n’y vivait. On ne pouvait pas y poser une caisse.

Un **monde** est tout autre chose : un objet doté de sa propre caméra, de ses propres accessoires et d’une vraie physique, qui s’ouvre comme un site web s’ouvre sur un aperçu de site ou un jeu sur une surface de jeu.

## Ce que signifie réellement créer un monde

```bf-figure
{
  "kind": "flow",
  "title": "D’une scène vide à quelque chose où l’on peut marcher",
  "steps": [
    { "label": "Placer", "note": "Déposez des accessoires dans la scène et déplacez-les. Chacun est un objet de votre tableau, avec le même panneau de réglages que tout autre objet.", "hue": "make" },
    { "label": "Cadrer", "note": "Déplacez la caméra. Ce que vous réglez est ce dans quoi quelqu’un d’autre ouvrira le monde.", "hue": "make" },
    { "label": "Marcher", "note": "Prenez le contrôle d’un personnage et déplacez-vous dans la scène avec un vrai poids, une vraie gravité et de vraies collisions.", "hue": "make", "tag": "physique" }
  ],
  "caption": "Construit sur Three.js avec un moteur physique Rapier : de vrais colliders, pas leur illusion, de sorte qu’un mur vous arrête et qu’une rampe vous ralentit."
}
```

```bf-figure
{
  "kind": "screen",
  "frame": "Un monde ouvert sur le canevas",
  "ratio": 1.62,
  "regions": [
    { "label": "La scène", "note": "Des accessoires avec colliders, une caméra que vous déplacez, un corps que le sol soutient", "x": 4, "y": 8, "w": 60, "h": 72, "hue": "make" },
    { "label": "Accessoires", "note": "Chacun est un objet de votre tableau", "x": 67, "y": 8, "w": 29, "h": 34, "hue": "idea" },
    { "label": "Réglages", "note": "Le même panneau que tout autre objet", "x": 67, "y": 46, "w": 29, "h": 34, "hue": "accent" },
    { "label": "Jouer · caméra · partager", "x": 4, "y": 86, "w": 92, "h": 9, "hue": "accent" }
  ],
  "caption": "Un monde est un objet comme les autres, ce qui explique qu’il hérite des réglages, du partage et de la barre de commandes plutôt que d’être un éditeur distinct greffé sur le côté."
}
```

La distinction qui compte, ce sont les **colliders**. Un très grand nombre d’outils 3D pour navigateur vous donnent une scène que l’on peut faire tourner autour. Très peu vous donnent un corps auquel la scène résiste. À partir du moment où il y a un personnage avec une masse, un sol qui le porte et des murs qui ne le laissent pas passer, ce que vous fabriquez cesse d’être un schéma d’espace et devient un espace, et les questions changent : on ne demande plus « est-ce que cela a l’air juste » mais « peut-on aller d’ici à là ».

## Les jeux créés ici se jouent désormais

Deux défaillances s’interposaient entre « demander un jeu » et « jouer à un jeu », et elles n’avaient aucun rapport entre elles, ce qui explique que corriger l’une ne semblait jamais aider.

**La première concernait la création.** Demander un jeu Roblox produisait un document de conception de quatre mille mots — piliers, classes, plan de monétisation, feuille de route sur douze mois — et rien de jouable. La moitié « livraison » était construite et la moitié « création » n’avait jamais été connectée : un outil créait l’objet, un autre produisait des artefacts, et rien ne les reliait. Le chemin vers une version jouable était un bouton d’inspecteur qui n’apparaissait qu’une fois qu’une version existait. Le bouton qui aurait créé un jeu exigeait donc qu’un jeu existe.

**La seconde concernait la reconnaissance.** Un lieu `.rbxlx` est du XML. Tout ce qui contenait un jeu demandait « est-ce du HTML ? » pour décider quel moteur d’exécution utiliser, et traitait un « non » comme *il n’y a pas de jeu ici*. Ainsi, un lieu Roblox généré, téléchargeable et correctement titré se trouvait sur le tableau pendant que la surface de jeu en dessous affichait **« Pas encore de jeu. »**

```bf-figure
{
  "kind": "compare",
  "title": "Deux questions qui avaient été fondues en une seule",
  "columns": [
    { "title": "Quel moteur d’exécution utilise-t-il ?", "hue": "make", "items": ["HTML → le moteur web", "Un lieu Roblox → le décoder et s’y promener", "Un monde → le moteur de scène"] },
    { "title": "Ce jeu existe-t-il ?", "hue": "measure", "items": ["Y a-t-il seulement un artefact ?", "La réponse vient de l’artefact, pas de son format", "Un vrai fichier répond désormais oui"] }
  ],
  "caption": "Une question portant deux casquettes est la forme la plus courante d’un bug qui n’a aucun sens vu de l’extérieur."
}
```

Un lieu Roblox est désormais jouable dans le navigateur — non pas en prétendant exécuter du Luau, qui est un moteur à autorité serveur qu’aucune page web n’est, mais en relisant le monde à partir du fichier et en s’y promenant dans le même moteur Three.js et Rapier que celui que le canevas possède déjà. Les pièces deviennent des accessoires à une échelle dérivée de la taille du personnage : un lieu construit en studs arrive donc à la taille pour laquelle il a été conçu.

Et un dernier cas, signalé depuis une surface de jeu en direct : une boucle de réapparition sur un danger qui clouait le personnage au point d’apparition, flèches du clavier mortes, tableau des scores affichant `0/3 collectés, 2076 touches`. Chaque contact avec un danger reconstruisait le gestionnaire de collisions, qui ré-enregistrait le collider, qui redéclenchait le chevauchement qui reconstruisait le gestionnaire. Le personnage ne manquait pas de bouger ; il était téléporté en arrière à chaque image. Il bouge désormais.

## Pourquoi un outil de construction embarque-t-il un moteur 3D

Parce que « rendre réel » ne veut pas toujours dire une page web.

Les [huit façons de rendre une idée réelle](/blog/eight-ways-to-make-an-idea-real) vont d’une bande démo de 90 secondes à un système en production, et la bonne preuve pour une idée spatiale — un scénario de formation, un plan d’étage dans lequel quelqu’un doit se déplacer, une boucle de jeu qui procure du plaisir ou non — n’est presque jamais une capture d’écran avec des flèches. Une scène où l’on peut marcher est une preuve réellement peu coûteuse d’une chose qu’il est autrement impossible de débattre dans un document.

Le même tableau contient les notes de conception, le code, les tickets et le monde. Tout l’argument est là : non pas qu’un canevas sache faire de la 3D, mais que la 3D se trouve à côté de tout le reste de ce qui décide si la chose sera réalisée.

---

**À lire aussi :** [Exécutez l’application que votre tableau vient de construire](/blog/run-your-app-on-the-canvas) · [Quarante-huit objets vivants, un seul Creation Canvas](/blog/forty-eight-live-objects-one-creation-canvas) · [Concevoir, construire, déboguer — un seul espace de travail spatial](/blog/design-build-debug-one-spatial-workspace)

[Ouvrez un canevas](/create) et demandez un monde avec une rampe et une porte verrouillée.
