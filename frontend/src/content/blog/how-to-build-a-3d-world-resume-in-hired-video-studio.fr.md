# Comment construire un CV en monde 3D dans le Creation Canvas de Builderforce

```bf-figure
{
  "kind": "launch",
  "title": "Ouvrir Studio sur un monde 3D",
  "links": [
    {
      "label": "Démarrer un CV en monde 3D",
      "hue": "build",
      "href": "/create/new?prompt=Create+a+3D+World+r%C3%A9sum%C3%A9+scene%3A+a+small+explorable+room+with+a+desk%2C+three+project+pedestals+a+visitor+can+walk+up+to%2C+and+a+nameplate+with+my+headline.",
      "note": "Moteur à scènes — Three.js, React Three Fiber, physique Rapier."
    },
    {
      "label": "Studio",
      "hue": "muted",
      "href": "/creation-canvas",
      "note": "L’éditeur lui-même : fenêtre d’affichage, palette d’objets et inspecteur."
    }
  ],
  "caption": "Un monde 3D est un `mediaKind: \"game\"` sur le moteur `world-3d`, et non l’un des anciens modèles de mini-jeux à sprites."
}
```

## Le CV jouable

Le format le plus audacieux pris en charge par le Creation Canvas de Builderforce est le monde 3D : une scène explorable qu’un recruteur peut parcourir. C’est excessif pour un poste de comptable et exactement ce qu’il faut pour un développeur de jeux, un artiste 3D, un artiste technique ou un ingénieur XR qui doit prouver qu’il sait livrer de la 3D interactive.

Sous le capot, le studio de mondes 3D est un document `mediaKind: "game"` doté d’un discriminant `engine: "world-3d"`, construit sur Three.js et React Three Fiber avec une couche physique Rapier. Vous placez des objets, vous câblez des interactions, et le résultat s’exécute dans n’importe quel navigateur moderne : aucune installation de Unity ou d’Unreal, aucun plugin.

## Étape 1 : créer un document de monde 3D

Ouvrez [Studio](/creation-canvas), créez un nouveau document et choisissez le type de jeu **Monde 3D**. L’éditeur charge une fenêtre d’affichage 3D, une palette d’objets et un inspecteur. (Les anciens modèles de jeux 2D existent toujours — ils portent désormais le badge « Mini-jeu » — mais un monde 3D est le moteur complet à scènes.)

Commencez par un simple plan de sol et un point d’apparition. Résistez à l’envie de construire un niveau entier. L’objectif est une courte promenade guidée qui raconte votre histoire, pas un jeu en monde ouvert.

## Étape 2 : placer des objets et ajouter de la physique

Faites glisser des objets de la palette dans la scène : plateformes, accessoires, panneaux de texte et zones de déclenchement. Chaque objet a une transformation (position, rotation, échelle) que vous réglez dans l’inspecteur. Ajoutez un corps physique Rapier aux objets qui doivent entrer en collision ou tomber : le moteur gère la simulation, de sorte qu’un accessoire lâché atterrit au sol sans que vous ayez à écrire une boucle de physique.

Utilisez les panneaux de texte comme colonne vertébrale du récit : un panneau à l’entrée avec votre nom et votre titre, des panneaux le long du chemin décrivant chaque projet, un panneau à la fin avec ce que vous recherchez. Le joueur lit le CV en se déplaçant à travers lui.

## Étape 3 : câbler les interactions

Les zones de déclenchement font passer la scène du diorama à l’expérience. Attachez une interaction à une zone pour que le fait d’y entrer révèle un panneau de projet, joue un son ou fasse avancer la caméra. Gardez les interactions découvrables : un recruteur qui explore votre monde pour la première fois ne devrait pas avoir à deviner une mécanique cachée pour voir votre travail.

Un bon schéma : un chemin linéaire avec des salles annexes facultatives. Le chemin principal raconte votre histoire essentielle en 60 à 90 secondes de marche ; les salles annexes contiennent des panneaux d’approfondissement pour les recruteurs qui en veulent davantage.

## Étape 4 : publier et partager le lien

Un monde 3D se publie comme une expérience jouable et partageable par lien, qui s’exécute dans le navigateur. Comme Studio s’exécute avec isolation cross-origin pour son environnement d’exécution, la scène se charge avec ses ressources auto-hébergées et se joue sans téléchargement.

Partagez le lien dans votre candidature, sur votre profil ou dans une publication Creator. Pour les postes de 3D interactive, un monde jouable est la pièce de portfolio : il prouve, de la manière la plus directe possible, que vous savez livrer exactement ce que le poste demande.

## Foire aux questions

### Dois-je savoir programmer pour construire un monde 3D ?

Non. Vous placez des objets, réglez les transformations dans l’inspecteur et câblez les interactions par des zones de déclenchement, le tout visuellement. Des connaissances en programmation permettent d’aller plus loin, mais la construction de base est un flux de travail de glisser-placer-configurer.

### Quelle est la différence entre un monde 3D et un mini-jeu ?

Un monde 3D est un moteur complet à scènes — `mediaKind: "game"` avec le moteur `world-3d` — construit sur Three.js, React Three Fiber et la physique Rapier. Les modèles de jeux 2D portent désormais le badge « Mini-jeu » et sont des expériences plus simples, à base de sprites. Pour une scène de CV qu’un recruteur explore en 3D, utilisez le monde 3D.

### Un recruteur doit-il installer quelque chose pour le voir ?

Non. Le monde s’exécute dans n’importe quel navigateur moderne via WebGL. Vous partagez un lien ; ils cliquent et explorent. Pas de moteur de jeu, pas de plugin, pas de téléchargement.

---

**Essayez-le :** [Studio](/creation-canvas) sur Builderforce.
