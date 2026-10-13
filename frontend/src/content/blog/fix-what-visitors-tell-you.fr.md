Regarder une visite vous dit ce qui s’est mal passé. Cela ne vous dit pas quoi changer, ce que vaut le changement, ni si le changement que vous avez livré a servi à quelque chose.

C’est là que s’arrêtent la plupart des données d’un site. Une carte de chaleur avec une tache rouge sur le titre. Un entonnoir qui chute à l’étape deux. Quarante enregistrements de gens qui abandonnent le même formulaire. Tout est vrai, et rien de tout cela n’est une décision. Quelqu’un doit encore en faire un changement, deviner si cela compte, rédiger le brief, le faire construire, puis — presque jamais — vérifier si le chiffre a bougé.

Insights fait désormais ce travail avec vous. Son accueil n’est plus un tableau de bord. C’est une courte liste de corrections.

## Les corrections, classées

Chaque correction part de quelque chose que les visiteurs ont réellement fait sur votre site : une part des visiteurs qui cliquent avec rage sur un élément, une erreur présente dans la plupart des visites qui décrochent à une étape, un titre sur lequel les gens cliquent comme s’il s’agissait d’un lien, le bouton principal placé sous l’endroit où la plupart cessent de défiler, des téléphones qui convertissent bien en dessous du bureau, une version qui a fait moins bien que la précédente. Ces constats viennent de règles appliquées à vos propres enregistrements, pas de l’opinion d’un modèle. L’IA ne fait que mettre en mots un constat cité et rédiger le changement ; une phrase qu’elle ne peut pas rattacher aux preuves est écartée.

Chaque correction porte une fourchette d’impact calculée à partir de vos propres visiteurs — les personnes qui ont rencontré le problème contre celles qui ne l’ont pas rencontré. Quand il y a trop peu de visites pour le dire, elle le dit au lieu d’inventer un chiffre. La liste est classée par impact rapporté à l’effort, de sorte que le changement bon marché et probable passe avant le changement coûteux et spéculatif.

```bf-figure
{
  "kind": "screen",
  "frame": "BuilderForce — Insights · Corrections",
  "ratio": 1.5,
  "regions": [
    { "label": "Corrections, classées", "note": "Impact rapporté à l’effort, la plus forte d’abord", "x": 4, "y": 6, "w": 32, "h": 88, "hue": "measure" },
    { "label": "Avant", "note": "La page telle qu’elle est, numérotée là où les visiteurs butent", "x": 39, "y": 6, "w": 28, "h": 56, "hue": "muted" },
    { "label": "Après", "note": "La même page avec le changement rendu", "x": 69, "y": 6, "w": 27, "h": 56, "hue": "make" },
    { "label": "Fourchette d’impact", "note": "Tirée de vos propres visiteurs, ou « trop peu de visites pour le dire »", "x": 39, "y": 66, "w": 28, "h": 28, "hue": "accent" },
    { "label": "Corriger · Tester · Relancer · Ticket", "note": "Une action, puis un verdict à la version suivante", "x": 69, "y": 66, "w": 27, "h": 28, "hue": "run" }
  ],
  "caption": "Les enregistrements, cartes de chaleur et entonnoirs sont toujours là. Ce sont les preuves derrière une correction, accessibles depuis elle, pas l’endroit où l’on commence."
}
```

## La page, telle qu’elle est et telle qu’elle serait

En plus de ce que les visiteurs ont fait, Insights passe en revue vos pages clés à chaque version : pages d’entrée, étapes d’entonnoir, pages de preuve et vos routes les plus visitées. Chacune est capturée en largeur bureau et téléphone, puis vérifiée sur les bases du référencement, le contenu, la performance et l’accessibilité — une description manquante, plus d’un titre principal, un appel à l’action vague, aucune raison de vous faire confiance au-dessus de la ligne de flottaison, une image d’en-tête lente, un texte difficile à lire, des zones tactiles trop petites. Vos données de recherche sont utilisées quand vous les avez connectées, et jamais inventées sinon. La capture ne remplit jamais de formulaire et ne se connecte jamais.

Un constat issu de l’examen de la capture d’écran n’est montré que s’il désigne un élément réel de la page et un fait mesuré à son sujet, et il est marqué comme observé.

Ensuite, le changement est dessiné. Pas décrit — rendu, sur votre page, avant et après.

```bf-figure
{
  "kind": "compare",
  "title": "La même page, avant et après le changement",
  "columns": [
    { "title": "Telle qu’elle est", "hue": "muted", "items": ["① Le titre ressemble à un lien, et les gens cliquent dessus", "② Le bouton principal est sous l’endroit où la plupart cessent de défiler", "③ Aucune raison de vous faire confiance avant la ligne de flottaison", "④ Texte gris sur fond clair"] },
    { "title": "Telle qu’elle serait", "hue": "make", "items": ["① Le titre est un texte simple avec une promesse claire", "② Le bouton remonte, à portée de vue", "③ Une ligne de preuve à côté du bouton", "④ Un contraste conforme"] }
  ],
  "caption": "Les numéros de gauche correspondent aux repères sur la page capturée. À droite, c’est cette page avec le changement appliqué, pas une maquette. Les changements de référencement s’affichent comme le résultat que les gens verraient."
}
```

## D’un constat à un verdict

Une correction que vous pouvez voir reste une correction que personne n’a faite. Chacune arrive donc avec un moyen de la réaliser — et aucune n’atteint la production toute seule.

- **Corriger.** Sur un site que vous hébergez chez nous, un agent de code fait le changement et vous recevez une version de prévisualisation. Une personne la publie.
- **Tester.** Lancez le changement en test A/B : les visiteurs sont répartis, chacun voit toujours la même version, et le test s’arrête selon une règle que vous fixez à l’avance, pas après un après-midi encourageant.
- **Relancer.** Quand le problème vous a coûté des visiteurs connus — quelqu’un qui a hésité sur les tarifs ou abandonné le paiement —, inscrivez-les dans une séquence de relance, selon vos propres règles commerciales.
- **Ticket.** Placez-le sur le tableau avec les preuves jointes.
- **Le confier à une IA.** Appliquez-le dans le composeur du canevas, ou copiez un prompt d’amélioration rédigé pour un agent de code ou pour le constructeur de site que vous utilisez.

```bf-figure
{
  "kind": "flow",
  "title": "Une correction, de bout en bout",
  "steps": [
    { "label": "Constat", "note": "Quelque chose que les visiteurs ont fait, ou un fait mesuré sur la page. Cité, pas deviné.", "hue": "measure" },
    { "label": "Prescription", "note": "Le changement, la raison, une fourchette d’impact tirée de vos visiteurs et le changement dessiné sur la page.", "hue": "idea" },
    { "label": "Appliquer", "note": "Corriger, Tester, Relancer ou Ticket — ou l’appliquer dans le composeur, le confier à un agent de code ou copier le prompt.", "hue": "make", "tag": "une personne décide" },
    { "label": "Version suivante", "note": "Détectée toute seule. La page est capturée et notée à nouveau.", "hue": "run" },
    { "label": "Verdict", "note": "A marché, sans effet ou pire. Pire sur une correction publiée propose un retour arrière.", "hue": "measure", "tag": "mesuré" }
  ],
  "caption": "Le registre montre chaque version avec les corrections qu’elle a livrées et ce qu’elles ont donné. Une correction sans verdict reste ouverte."
}
```

Le verdict est la partie que la plupart des outils oublient. Une correction ou un ticket est jugé sur le comportement des visiteurs sur la route avant et après la version qui l’a livré. Un test est jugé sur ses variantes. Une relance est jugée sur les personnes inscrites face à celles qui correspondaient et ne l’ont pas été. La réponse tient en trois mots — a marché, sans effet, pire —, et « pire » sur un changement que vous avez publié vient avec un chemin de retour.

## Où ça se place dans la méthode

La méthode a un arc — **Idée → Faire → Exécuter → Mesurer → Portée** — et une boucle intérieure de trois actes : **Lire, Prouver, Construire**. [Voyez pourquoi les visiteurs partent](/blog/see-why-visitors-leave) a placé les enregistrements sur Mesurer, comme la note d’une preuve. Les corrections sont l’autre moitié : le pont qui ramène de Mesurer à Faire.

- **Corriger, c’est Faire.** C’est un Construire, limité à un constat cité, avec une prévisualisation qu’une personne publie.
- **Tester, c’est une preuve.** Une condition d’arrêt, un échantillon, une règle d’arrêt — la même forme que n’importe quelle preuve de la [liste, la moins chère d’abord](/blog/eight-ways-to-make-an-idea-real), menée sur la page que vous avez déjà.
- **Le verdict, c’est Mesurer, encore.** La version suivante est notée sur ce que les visiteurs ont fait, pas sur le fait que le changement soit sorti.
- **Un échec, c’est le prochain Lire.** Quand une preuve échoue, la raison qu’elle cite devient un constat à part entière, et vous relisez l’idée avec cette raison en main.

```bf-figure
{
  "kind": "flow",
  "title": "De Mesurer à Faire, et un nouveau tour",
  "steps": [
    { "label": "Mesurer", "note": "Les enregistrements, les cartes de chaleur et la revue de page produisent des constats cités.", "hue": "measure" },
    { "label": "Faire", "note": "Corriger : un changement, une version de prévisualisation, une personne publie.", "hue": "make", "tag": "Construire" },
    { "label": "Prouver", "note": "Tester : un test A/B avec une règle d’arrêt fixée avant qu’il commence.", "hue": "prove", "tag": "une preuve" },
    { "label": "Mesurer", "note": "La version suivante est détectée et notée : a marché, sans effet, pire.", "hue": "measure", "tag": "verdict" },
    { "label": "Lire", "note": "La raison citée d’une preuve manquée devient ce contre quoi vous relisez l’idée.", "hue": "read" }
  ],
  "caption": "Idée → Faire → Exécuter → Mesurer est l’arc. Les corrections sont la façon dont Mesurer cesse d’être un rapport et devient le prochain changement."
}
```

[Lire, Prouver, Construire](/blog/read-prove-build-the-inner-loop) est la boucle intérieure. [Noter la preuve](/blog/grade-the-proof-and-close-the-loop) est l’endroit où le chiffre s’écrit. Ceci est ce que vous faites du chiffre une fois qu’il est écrit.

Installez Insights, déposez le snippet sur votre site ou activez l’enregistrement pour une app hébergée, et les premières corrections arrivent dès qu’il y a des visites où les lire.

---

**Lectures associées :** [Voyez pourquoi les visiteurs partent](/blog/see-why-visitors-leave) · [Noter la preuve](/blog/grade-the-proof-and-close-the-loop) · [Lire, Prouver, Construire](/blog/read-prove-build-the-inner-loop) · [Idée, Faire, Exécuter, Mesurer](/blog/idea-make-run-measure-menu-as-methodology)

[Ouvrir un canevas](/create) et corriger la première chose que vos visiteurs vous ont dite.
