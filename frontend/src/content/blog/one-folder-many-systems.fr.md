Vous lancez une revue sur le dossier où vous rangez votre travail. Il contient cinq dépôts et deux copies volantes de l'un d'eux, faites pour un test et jamais supprimées. Vous attendez une carte de cinq systèmes.

Vous avez obtenu un seul système. Chaque ligne portait le nom de ce qui venait en premier, la plupart s'arrêtaient après une seule station, et les copies étaient comptées comme du vrai code, si bien que les mêmes problèmes apparaissaient trois fois. Sur les plus gros dossiers, la plupart des fichiers n'étaient jamais lus, car la revue s'arrêtait à un nombre fixe.

Voilà le manque : **un gros dossier se lisait comme un seul système enchevêtré, et les copies parasites polluaient la carte.**

## Chaque système est son propre système

La revue regarde désormais ce que contient le dossier et le découpe. Un sous-dossier qui est son propre dépôt est un système. Un dossier avec un manifeste de projet est un système. Dans un système, ses paquets de workspace sont les apps qui le composent. Un dossier qui est lui-même un dépôt reste simplement un système.

```bf-figure
{
  "kind": "compare",
  "title": "Le même dossier, avant et après",
  "columns": [
    { "title": "Avant", "hue": "muted", "items": ["Cinq dépôts et deux copies lus comme un projet", "Lignes nommées d'après les copies", "Chaque ligne s'arrêtait après une station", "Problèmes recomptés pour chaque copie", "Sur un gros dossier, la plupart des fichiers jamais lus"] },
    { "title": "Maintenant", "hue": "make", "items": ["Chaque dépôt est son propre système", "Lignes groupées par système, nommées système et paquet", "Chaque ligne dit où et pourquoi elle s'arrête", "Problèmes comptés au sein d'un système seulement", "Aucun plafond : tout le dossier est cartographié"] }
  ],
  "caption": "Rien n'a changé dans votre dossier. La carte a simplement cessé de faire comme s'il n'était qu'une seule chose."
}
```

Les lignes sont groupées par système et réparties équitablement, pour qu'un gros système ne chasse pas les autres de la carte. L'en-tête commence au système où vous êtes. Quand le dossier contient plus d'un système, la vue Système montre un niveau pour chacun.

## Les copies parasites sont trouvées, pas devinées

Quand deux systèmes portent le même projet et que leurs fichiers coïncident presque entièrement, la revue y voit une copie. Elle vous dit quel dossier ressemble à la copie parasite, en général celui sans dépôt derrière lui, et pourquoi. Tant que vous n'avez pas décidé, la copie reste sur la carte, marquée comme copie, ses lignes repliées sous l'original pour ne pas doubler le bruit.

Vous décidez d'un clic.

```bf-figure
{
  "kind": "flow",
  "title": "D'un dossier encombré à une carte propre",
  "steps": [
    { "label": "Revue", "note": "Pointez-la sur le dossier. Chaque système est trouvé et dessiné à part.", "hue": "idea" },
    { "label": "Détecter les copies", "note": "Une arborescence embarquée ou dupliquée est signalée comme copie, avec la raison.", "hue": "make" },
    { "label": "Exclure", "note": "Un clic ajoute le dossier à votre liste d'exclusion et lance une nouvelle revue avec l'estimation et la confirmation habituelles.", "hue": "run", "tag": "votre choix" },
    { "label": "Carte propre", "note": "Il ne reste que le vrai code, groupé par système.", "hue": "measure" }
  ],
  "caption": "La revue trouve le problème et propose le remède. Elle ne modifie jamais votre dossier dans votre dos, et vous n'avez jamais à éditer un fichier d'exclusion à la main."
}
```

**Exclure est une nouvelle revue ordinaire.** Elle suit les mêmes étapes de plan, d'estimation et de confirmation que toute autre : vous voyez ce qu'elle coûtera avant de dépenser quoi que ce soit, et ensuite la copie a disparu de la carte.

## Aucun plafond, rien d'écarté en silence

Un gros dossier est lu en entier. La seule limite restante est la taille d'un fichier, et chaque fichier ignoré est compté et nommé dans le diagnostic : un trou dans la carte se lit au lieu de se soupçonner. Un système interrompu le dit.

Les références entre systèmes sont présentées comme externes, pas comme une erreur de couches. Un service qui appelle un autre dépôt n'est plus signalé comme violant sa propre architecture.

```bf-figure
{
  "kind": "screen",
  "frame": "Revue d'un dossier de plusieurs systèmes",
  "ratio": 1.62,
  "regions": [
    { "label": "Systèmes", "note": "Un niveau par système quand le dossier en contient plusieurs", "x": 4, "y": 8, "w": 56, "h": 52, "hue": "make" },
    { "label": "Lignes par système", "note": "Groupées par système, nommées système et paquet, chacune avec sa raison d'arrêt", "x": 64, "y": 8, "w": 32, "h": 52, "hue": "idea" },
    { "label": "Copie trouvée · Exclure de la revue", "note": "Le dossier parasite, pourquoi il ressemble à une copie, et le bouton", "x": 4, "y": 64, "w": 56, "h": 30, "hue": "run" },
    { "label": "Diagnostic", "note": "Systèmes, copies, fichiers ignorés, où chaque ligne s'arrête", "x": 64, "y": 64, "w": 32, "h": 30, "hue": "measure" }
  ],
  "caption": "À quoi ressemble désormais un workspace de plusieurs dépôts : les systèmes, la copie et le moyen de l'écarter sur un seul écran."
}
```

## Sa place dans la méthode

C'est l'étape **Read** (Lire) : comprendre ce que l'on a avant de construire. La méthode va de Read à Prove puis Build, et l'arc qui l'entoure va d'Idea à Make, Run et Measure. Une carte qui fond cinq systèmes en un, ou compte une copie parasite comme du vrai code, donne une image fausse pour décider, et chaque étape suivante hérite de l'erreur. Lire chaque système pour lui-même et écarter les copies fait reposer la décision de construire sur ce qui existe réellement.

## Ce que vous pouvez faire dès aujourd'hui

- **Passer en revue un workspace de plusieurs dépôts** et voir chacun comme son propre système.
- **Lire un monorepo par paquets**, avec des lignes groupées sous le système auquel elles appartiennent.
- **Repérer les copies parasites** et les retirer de la carte d'un clic, après l'estimation habituelle.
- **Se fier à la taille de la carte**, car aucun fichier n'est écarté pour être le dix-millième.

---

**À lire aussi :** [Watch your codebase review run](/blog/watch-your-codebase-review-run) · [Run the app your board just built](/blog/run-your-app-on-the-canvas)
