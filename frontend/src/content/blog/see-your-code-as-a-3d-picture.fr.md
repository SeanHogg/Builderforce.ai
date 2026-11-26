La plupart des personnes qui dépendent d'un logiciel ne peuvent pas le lire. Responsables produit, fondateurs, auditeurs et nouvelles recrues doivent pourtant répondre à des questions à son sujet : quelle est la taille de cette partie, qu'est-ce qui en dépend, est-il sûr de la modifier ? La réponse habituelle consiste à demander à l'unique ingénieur qui s'y connaît, puis à attendre.

Désormais, **la vue Connaissance montre le code et une image 3D du système côte à côte, et se déplacer dans l'un déplace aussi l'autre.**

## Un lieu, deux vues

Le code est à gauche, l'image à droite. Ils partagent un seul emplacement, qui va du système entier à une ligne, en passant par un composant, une classe et une méthode.

```bf-figure
{
  "kind": "screen",
  "frame": "La vue Connaissance",
  "ratio": 1.62,
  "regions": [
    { "label": "Code", "note": "Classes et méthodes, avec des lentilles au-dessus", "x": 3, "y": 8, "w": 44, "h": 78, "hue": "read" },
    { "label": "Image 3D", "note": "Des formes pour le même système, au même endroit", "x": 50, "y": 8, "w": 47, "h": 78, "hue": "make" },
    { "label": "système > composant > classe > méthode > ligne", "x": 3, "y": 89, "w": 94, "h": 8, "hue": "accent" }
  ],
  "caption": "Un seul emplacement, montré deux fois. L'endroit où vous êtes dans le code est celui que regarde l'image, et inversement."
}
```

- **Cliquez sur une forme et son code s'ouvre** à gauche.
- **Cliquez sur une classe ou une méthode dans le code et l'image s'enfonce** jusqu'à cet endroit.
- **Zoomez dans une forme et elle s'ouvre.** Un composant devient ses classes, une classe devient ses méthodes, une méthode devient son code. Vous n'avez jamais besoin de savoir dans quel fichier vous êtes.

Si vous ne savez pas lire le code, vous pouvez quand même le voir à travers des formes : ce qui est grand, ce qui est emmêlé, ce qui se relie à quoi. Si vous savez le lire, vous n'avez plus à garder la carte en tête.

## Des lentilles au-dessus du code

Au-dessus de chaque classe et méthode se trouve une rangée de petites actions :

- **Entrer** et **sortir**, pour descendre ou remonter d'un niveau.
- **Appelants**, pour voir ce qui en dépend.
- **No test · Simulate**, affiché quand aucun test ne couvre ce chemin. Il ouvre le simulateur de chemin pour que vous exécutiez le chemin et voyiez ce qui se passe.
- **Restructure**, affiché sur les anti-patterns. Un symbole d'avertissement dans la marge signale le même code, ce qui permet de le repérer en faisant défiler.

## Flow et Sequence à chaque niveau

Chaque niveau a une vue **Flow** et une vue **Sequence** : comment les données circulent, et dans quel ordre les éléments s'appellent. Elles fonctionnent pour le système, un composant, une classe et une méthode. Un seul interrupteur fait passer chacune de la 3D au Flat, pour choisir la plus lisible selon la question.

## Avant et Après

Un anti-pattern se juge plus facilement en image qu'en description. Par exemple un module fourre-tout qui a tout absorbé, ou une violation de couches où la mauvaise partie va chercher dans une autre.

```bf-figure
{
  "kind": "compare",
  "title": "Prévisualiser une restructuration",
  "columns": [
    { "title": "Avant", "hue": "muted", "items": ["Un gros fichier qui cumule plusieurs rôles", "Des liens qui traversent des couches qu'ils ne devraient pas traverser", "Difficile de dire où un changement va atterrir"] },
    { "title": "Après (proposition)", "hue": "make", "items": ["De nouveaux modules poussent à partir de l'ancien fichier", "Les liens sont réacheminés par la bonne couche", "Le nouveau, le modifié et le supprimé sont distingués par la couleur"] }
  ],
  "caption": "La proposition est un aperçu. Rien dans votre code ne change tant que vous ne l'appliquez pas."
}
```

Passez à **Après** : de nouveaux modules poussent à partir de l'ancien fichier pendant que les liens se réacheminent. La couleur distingue ce qui est nouveau, ce qui a changé et ce qui est supprimé. Vous jugez la forme du changement avant de lire la moindre ligne du diff.

Vous pouvez aussi choisir **un commit de l'historique**. La carte montre ce que ce commit a changé, et le code montre quelles lignes.

Les propositions sont des aperçus. Les appliquer passe par le flux de correction habituel, avec relecture : une personne approuve toujours le changement, et il est vérifié comme les autres.

## Où cela se place dans la méthode

Builderforce fonctionne selon **Read, Prove, Build** dans l'arc Idea, Make, Run, Measure. Read et Prove sont les étapes peu coûteuses, et elles décident si Build en vaut la peine. Cette fonction relève de **Read et Prove, dans Idea**.

Elle était nécessaire là parce que lire du code existant est la partie lente de cette étape. Si vous héritez d'un système, ou devez juger une modification, le seul accès était une arborescence de fichiers et un après-midi. Vous lisez maintenant la forme du système en quelques minutes. L'aperçu de restructuration est une preuve au même sens : vous voyez ce qu'un changement ferait, avec une condition d'arrêt vérifiable (cette proposition supprime-t-elle réellement la violation ?), avant de dépenser le moindre effort de construction. Ce que vous décidez de construire passe ensuite à [Make](/blog/read-prove-build-the-inner-loop), et un commit que vous pouvez comparer à l'historique est la façon dont Measure montre ensuite ce qu'il a produit.

---

**À lire aussi :** [Read, Prove, Build : la boucle interne](/blog/read-prove-build-the-inner-loop) · [Concevoir, construire, déboguer : un espace de travail spatial](/blog/design-build-debug-one-spatial-workspace) · [Construire un monde 3D dans le navigateur](/blog/build-a-3d-world-in-the-browser)

[Ouvrez un canevas](/create), passez à la vue Connaissance dans un projet et cliquez sur une forme.
