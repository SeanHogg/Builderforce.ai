Vous cliquez sur Review pour un dossier. Un spinner apparaît. Quelque part, des fichiers sont lus, résumés et jugés, et vous n'avez aucun moyen de savoir s'il en est au fichier 12 sur 40 ou bloqué au fichier 3. Si cela échoue, vous l'apprenez à la fin, et le seul remède est de tout recommencer.

La carte avait aussi une seconde faiblesse. Elle était dessinée à partir de la copie du serveur : dès que vous vous déconnectiez, atteigniez une limite de débit ou perdiez la connexion, la carte que vous veniez de construire devenait blanche.

Voilà le manque : **une revue était un spinner dans lequel on ne voyait rien, et la carte disparaissait sans le serveur.**

## La carte est à vous, et elle fonctionne hors ligne

La carte de connaissances est désormais dessinée à partir de la copie présente sur votre propre machine, que l'espace de travail soit lié ou non. Le serveur est un réplica, tenu à jour par une file d'attente en arrière-plan qui survit à une déconnexion, à une limite de débit ou à un plantage, et reprend simplement là où elle s'était arrêtée. Un dossier que le serveur possède mais pas votre machine est tout de même dessiné, en lecture seule : vous voyez qu'il existe sans prétendre l'avoir.

```bf-figure
{
  "kind": "flow",
  "title": "D'où vient la carte désormais",
  "steps": [
    { "label": "Votre machine", "note": "La carte est lue depuis la copie locale, liée ou non. Déconnectez-vous, passez hors ligne, atteignez une limite : elle s'ouvre quand même.", "hue": "make" },
    { "label": "File en arrière-plan", "note": "Les changements attendent dans une file qui survit à un plantage et réessaie d'elle-même.", "hue": "run" },
    { "label": "Le réplica du serveur", "note": "Se met à jour dès qu'il le peut. Un dossier que seul le serveur possède est dessiné en lecture seule.", "hue": "measure", "tag": "une copie, pas la source" }
  ],
  "caption": "Le sens de la vérité a changé : la copie locale est lue d'abord, et le serveur suit."
}
```

## Chaque revue est une exécution que vous pouvez ouvrir

Review et Re-review ouvrent désormais un panneau d'exécution intitulé Run details. Il répond aux questions que le spinner n'a jamais pu résoudre.

```bf-figure
{
  "kind": "screen",
  "frame": "Run details d'une revue de dossier",
  "ratio": 1.62,
  "regions": [
    { "label": "Chronologie des phases", "note": "Planifier, extraire, juger, terminer : où en est l'exécution à cet instant", "x": 4, "y": 6, "w": 92, "h": 14, "hue": "run" },
    { "label": "Voies des workers", "note": "Sur quels fichiers travaille chaque thread en ce moment", "x": 4, "y": 24, "w": 44, "h": 40, "hue": "make" },
    { "label": "Étapes", "note": "La liste ordonnée, ce qui est fait et ce qui reste", "x": 52, "y": 24, "w": 44, "h": 40, "hue": "idea" },
    { "label": "Échecs · Retry", "note": "Ce qui a mal tourné, avec un Retry à côté", "x": 4, "y": 68, "w": 44, "h": 26, "hue": "measure" },
    { "label": "Historique des exécutions", "note": "Les 20 dernières exécutions de ce dossier ; un plantage apparaît comme « interrompue »", "x": 52, "y": 68, "w": 44, "h": 26, "hue": "accent" }
  ],
  "caption": "Un seul panneau pour toute l'exécution : où elle en est, qui fait quoi, ce qui a échoué et ce qui s'est passé les vingt dernières fois."
}
```

**Retry n'est pas un raccourci qui contourne les règles.** Il marque les fichiers en échec comme dus et les fait passer par le déroulé normal : planifier, estimer, confirmer. Vous voyez ce que coûtera la nouvelle tentative avant de dépenser quoi que ce soit, exactement comme la première fois.

**L'historique dit la vérité sur les plantages.** Chaque dossier conserve ses 20 dernières exécutions. Une exécution interrompue par un plantage est marquée « interrompue » au lieu de disparaître en silence : vous savez qu'elle n'est pas allée au bout et pouvez la reprendre.

## Plus rapide, sans écraser votre fournisseur

La lecture des fichiers se répartit désormais sur plusieurs threads de travail de votre machine, jusqu'à huit et jamais plus que vos cœurs moins un, pour que l'éditeur reste réactif. Le jugement traite quatre fichiers à la fois. Tous ces appels partagent un seul limiteur : au plus six appels au modèle en vol, et la limite est divisée par deux dès qu'un fournisseur demande de ralentir. Le parallélisme ne multiplie donc jamais la charge sur le fournisseur ; il occupe seulement la marge que la limite autorise.

Les résultats sont identiques à ceux d'une exécution en série. Les mêmes fichiers sont jugés de la même façon, simplement plus tôt.

## Où cela se place dans la méthode

C'est **Run**, avec un pied dans **Measure**. Une revue, c'est la base de code au travail, et une exécution que l'on peut observer est une exécution à laquelle on peut se fier et que l'on peut ajuster. L'historique et les échecs qu'il conserve sont les premières mesures de la qualité de ce travail, et ils alimentent l'idée suivante : quoi corriger ou revoir.

```bf-figure
{
  "kind": "compare",
  "title": "Une revue, avant et maintenant",
  "columns": [
    { "title": "Avant", "hue": "muted", "items": ["Un spinner sans rien derrière", "Échec connu seulement à la fin", "Tout recommencer pour récupérer", "Carte blanche si le serveur est injoignable"] },
    { "title": "Maintenant", "hue": "run", "items": ["Chronologie des phases et voies des workers", "Échecs listés, chacun avec Retry", "Retry passe par planifier, estimer, confirmer", "La carte s'ouvre depuis votre machine, liée ou non"] }
  ],
  "caption": "La même revue, avec son intérieur visible et une carte qui ne dépend plus d'une connexion."
}
```

## Ce que vous pouvez faire dès aujourd'hui

- **Ouvrir la carte sans connexion**, connecté ou non, lié ou non.
- **Regarder une revue** et voir sur quels fichiers travaille chaque worker.
- **Ne relancer que ce qui a échoué**, après avoir vu l'estimation.
- **Revenir en arrière** sur les 20 dernières exécutions de n'importe quel dossier.

---

**À lire aussi :** [Exécutez l'application que votre tableau vient de construire](/blog/run-your-app-on-the-canvas) · [Votre Evermind privé sur votre machine](/blog/your-private-evermind-on-your-machine)
