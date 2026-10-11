Un tableau de bord peut vous dire que les gens sont partis. Il ne peut pas vous dire pourquoi. Taux de rebond, temps sur la page, un entonnoir qui chute entre l’étape deux et trois — ce sont des comptes. Ils se taisent sur le titre qui ressemblait à un lien, le bouton qui n’a pas tiré, le formulaire qui a avalé la première tentative, le moment où quelqu’un a cliqué avec rage et fermé l’onglet.

Ce silence est coûteux. Les équipes se disputent de mémoire autour d’une visite que personne n’a regardée. Elles livrent un correctif pour la mauvaise chose. Elles notent une preuve sur un chiffre qui n’a jamais demandé si l’échantillon avait vraiment été atteint, ni si ceux qui n’ont pas converti ont vu une page cassée.

La relecture de session ferme cet écart. Vous voyez la visite comme le visiteur l’a vue.

## La visite, sur la page qu’ils ont vue

Insights a maintenant une lecture Visitors qui joue la session : la page, le curseur, le clic qui n’est allé nulle part. Une visite porte la version sur laquelle elle a tourné. Clics de rage, clics morts, erreurs et la conversion (ou le raté) sont sur la timeline pour que vous puissiez y sauter, pas les chercher.

```bf-figure
{
  "kind": "screen",
  "frame": "BuilderForce — Visitors",
  "ratio": 1.5,
  "regions": [
    { "label": "Enregistrements", "note": "Une visite, étiquetée avec la version sur laquelle elle a tourné", "x": 4, "y": 6, "w": 36, "h": 88, "hue": "measure" },
    { "label": "La page qu’ils ont vue", "note": "La relecture joue la Salle, le formulaire, le clic qui n’est allé nulle part", "x": 42, "y": 6, "w": 54, "h": 58, "hue": "accent" },
    { "label": "Moments", "note": "Clic de rage · clic mort · erreur · conversion", "x": 42, "y": 68, "w": 54, "h": 26, "hue": "run" }
  ],
  "caption": "L’enregistrement est la visite. Les comptes sont à côté pour que vous trouviez le moment, puis le regardiez."
}
```

Les saisies restent masquées. Les clés API restent bloquées. Une visite connectée sur builderforce.ai et l’anonyme qui l’a précédée sont le même enregistrement.

## D’un enregistrement au prochain changement

Regarder n’est pas le but. Le but est ce que vous faites du moment.

```bf-figure
{
  "kind": "flow",
  "title": "D’un site en ligne au prochain ticket",
  "steps": [
    { "label": "Exécuter", "note": "L’app hébergée ou le snippet sur votre propre origine enregistre la visite.", "hue": "run" },
    { "label": "Enregistrer", "note": "Les morceaux arrivent en quelques secondes. Frustration, erreurs et conversions sont marquées au moment où elles arrivent.", "hue": "measure" },
    { "label": "Regarder", "note": "Ouvrez l’enregistrement. Sautez au clic de rage. Voyez la page qu’ils ont vraiment vue.", "hue": "measure", "tag": "la visite" },
    { "label": "Ticket", "note": "Un moment devient une tâche, avec l’enregistrement attaché, pour que le correctif soit pour ce clic.", "hue": "idea" },
    { "label": "Faire", "note": "La prochaine version porte le changement. Les cartes de chaleur et les enregistrements de cette version vous disent s’il a marché.", "hue": "make" }
  ],
  "caption": "La boucle est le produit. Un enregistrement qui ne devient pas un ticket est une vidéo que vous avez regardée une fois."
}
```

## Une version contre la suivante

Une carte de chaleur sans version est une moyenne de chaque page que vous avez jamais livrée. C’est ainsi qu’un titre cassé de la semaine dernière se cache dans une carte de clics qui a l’air saine.

```bf-figure
{
  "kind": "compare",
  "title": "La même page, deux versions",
  "columns": [
    { "title": "Cette version", "hue": "muted", "items": ["Rage sur le titre qui ressemble à un lien", "Clics morts sur un bouton qui n’a jamais tiré", "Défilement qui n’a jamais atteint le formulaire"] },
    { "title": "La prochaine version", "hue": "measure", "items": ["Le titre est un titre", "Le bouton envoie", "Le formulaire est en vue — et les gens l’utilisent"] }
  ],
  "caption": "Comparez les cartes de chaleur par version, pas par URL. L’URL n’a pas changé. La page si."
}
```

## Où ça se place dans la méthode

**Mesurer** est l’endroit où la condition d’arrêt d’une preuve est notée. La relecture est ce qui la note : un échantillon vraiment atteint, un événement de succès que les visiteurs ont vraiment déclenché, et des enregistrements des visiteurs qui n’ont pas converti.

Cette preuve revient à **Idée** — relire avec ce que vous avez appris — et passe à **Faire** : un ticket depuis le moment, dont vous mesurez l’effet sur la prochaine version.

[Lire, Prouver, Construire](/blog/read-prove-build-the-inner-loop) est la boucle intérieure. [Noter la preuve](/blog/grade-the-proof-and-close-the-loop) est l’endroit où le chiffre s’écrit. La relecture est la façon dont ce chiffre cesse d’être un tableau de bord et commence à être une visite que vous pouvez regarder.

```bf-figure
{
  "kind": "flow",
  "title": "La boucle, notée par la visite",
  "steps": [
    { "label": "Prouver", "note": "Une condition d’arrêt, une taille d’échantillon, un événement de succès. Pas cher exprès.", "hue": "idea" },
    { "label": "Construire", "note": "La plus petite chose qui puisse être atteinte.", "hue": "make" },
    { "label": "Exécuter", "note": "Une origine en ligne, un jeton de version, un snippet ou une app hébergée.", "hue": "run" },
    { "label": "Mesurer", "note": "La relecture note la preuve : échantillon atteint, événement déclenché, enregistrements de ceux qui n’ont pas converti.", "hue": "measure", "tag": "notée par la relecture" },
    { "label": "Idée", "note": "Relire avec ce que les visites ont montré. Le prochain Faire part d’un moment, pas d’une conjecture.", "hue": "idea" }
  ],
  "caption": "Idée → Faire → Exécuter → Mesurer est l’arc. La relecture est la note sur Mesurer, pas un produit à part à côté."
}
```

Installez Insights, posez un snippet sur votre site, ou activez l’enregistrement pour une app hébergée. La première visite arrive en quelques secondes. La méthode elle-même est [le menu](/blog/idea-make-run-measure-menu-as-methodology).

---

**À lire aussi :** [Noter la preuve](/blog/grade-the-proof-and-close-the-loop) · [Lire, Prouver, Construire](/blog/read-prove-build-the-inner-loop) · [Idée, Faire, Exécuter, Mesurer](/blog/idea-make-run-measure-menu-as-methodology)

[Ouvrir un canevas](/create) et regarder la prochaine visite.
