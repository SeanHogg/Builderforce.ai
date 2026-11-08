# Publiez votre vidéo de lancement sur YouTube — depuis la même campagne que tout le reste

Vous rendez la vidéo de lancement sur le tableau. Vous rédigez l’annonce une seule fois. Vous cochez X, LinkedIn, Instagram, TikTok — et YouTube.

Jusqu’ici, YouTube était la case qui disait non.

Tous les autres réseaux acceptent une publication sous la forme d’une seule requête : du texte, peut-être un lien, peut-être une image que le réseau va chercher lui-même. YouTube, non. Publier sur YouTube signifie *lui envoyer la vidéo*, chaque octet, et un film de lancement de trois minutes dépasse de loin ce qu’une requête a le temps de transporter. La réponse honnête était donc de marquer YouTube « lecture et mesure seulement » : le tableau pouvait afficher les vues de votre chaîne, mais l’envoi lui-même passait par YouTube Studio, un téléchargement, un nouvel envoi et une description recopiée de quelque part.

Cela faisait de l’élément le plus important d’un lancement le seul qui ne pouvait pas partir avec le lancement.

## Un envoi qui survit à la requête qui l’a démarré

La solution n’est pas une requête plus longue. C’est de cesser de traiter l’envoi comme une requête.

```bf-figure
{
  "kind": "flow",
  "title": "Ce qui se passe quand une campagne atteint YouTube",
  "steps": [
    { "label": "Passer la main", "note": "La publication YouTube devient une tâche d’envoi avec son propre enregistrement : quelle vidéo, quelle chaîne, quelle part YouTube a confirmée.", "hue": "reach" },
    { "label": "Envoyer un morceau", "note": "Quelques mégaoctets à la fois, chacun étiqueté avec l’endroit exact qu’il occupe dans le fichier.", "hue": "reach" },
    { "label": "Demander, ne pas supposer", "note": "Avant d’en envoyer davantage, la tâche demande à YouTube jusqu’où il est réellement arrivé, et reprend à partir de là.", "hue": "measure" },
    { "label": "Atterrir", "note": "YouTube renvoie la vidéo. La publication de la campagne devient un lien.", "hue": "reach", "tag": "sur la campagne" }
  ],
  "caption": "Un court clip se termine en un seul morceau. Un long film en prend autant qu’il en faut. C’est le même chemin dans les deux cas : le teaser de cinq secondes et la keynote de quarante minutes ne peuvent donc pas se comporter différemment."
}
```

La troisième étape est celle qui compte. Un worker cloud peut être arrêté à tout moment. S’il est arrêté au milieu de l’envoi d’un morceau, la tâche ne fait pas confiance à sa propre idée de ce qui est parti. Elle demande à YouTube, et YouTube indique exactement ce qu’il possède. La tentative suivante repart de ce point. Le pire qu’une connexion interrompue puisse coûter est un morceau, jamais la vidéo entière.

Il en va de même pour une mauvaise minute du côté de YouTube. Une erreur temporaire attend puis réessaie, un peu plus longtemps à chaque fois. Une erreur qu’attendre ne peut pas corriger, comme un quota quotidien épuisé ou une connexion à rétablir, s’arrête immédiatement et en donne la raison. Elle ne réessaie pas en boucle.

## Ce que vous voyez

```bf-figure
{
  "kind": "screen",
  "frame": "Une campagne de lancement sur le tableau",
  "ratio": 1.62,
  "regions": [
    { "label": "Publié · X", "note": "Lien vers la publication", "x": 4, "y": 10, "w": 44, "h": 16, "hue": "good" },
    { "label": "Publié · LinkedIn", "x": 52, "y": 10, "w": 44, "h": 16, "hue": "good" },
    { "label": "Publié · Instagram", "x": 4, "y": 32, "w": 44, "h": 16, "hue": "good" },
    { "label": "Envoi · 62 % · YouTube", "note": "Confirmé par YouTube, pas estimé", "x": 52, "y": 32, "w": 44, "h": 16, "hue": "reach" },
    { "label": "Texte · lien · la vidéo", "x": 4, "y": 56, "w": 92, "h": 36, "hue": "muted" }
  ],
  "caption": "YouTube figure dans la même liste que tous les autres réseaux. Son statut se lit En file d’attente, puis Envoi avec un pourcentage, puis Publié avec un lien, ou Échec avec la raison."
}
```

Le pourcentage est la part de la vidéo que YouTube a **confirmée**, pas celle que nous avons envoyée. Ces deux chiffres peuvent différer, et lorsqu’ils diffèrent, c’est le chiffre confirmé qui est vrai. La campagne reste aussi en cours tant que la vidéo est encore en train de monter. Elle ne se déclare pas publiée tant que YouTube n’a qu’une partie du fichier.

Le même outil d’envoi se trouve derrière **Publier sur YouTube** pour une vidéo dans l’éditeur du canevas. Un rendu court se termine toujours avant que le bouton cesse de tourner. Un rendu long montre désormais la part déjà arrivée, continue après la fermeture de l’onglet, et le lien apparaît sur la vidéo la prochaine fois que quelqu’un l’ouvre. Les longs rendus échouaient auparavant du seul fait d’être longs. Ce n’est plus le cas.

## Ce qu’il faut

Deux choses, toutes deux ponctuelles :

- **Un compte YouTube sur la campagne.** Connectez-le avec les autres comptes de réseaux sociaux, et il apparaît comme une cible.
- **Une connexion d’envoi YouTube.** Connectez YouTube une fois depuis une vidéo sur le canevas. Cela permet aux envois d’aller sur votre chaîne. Si la personne qui a connecté le compte YouTube de la campagne l’a fait, sa chaîne est utilisée. Si personne ne l’a fait, ou si deux personnes l’ont fait et que l’on ne sait pas quelle chaîne est visée, la publication l’indique au lieu de deviner. Une vidéo de lancement sur la mauvaise chaîne ne peut pas être retirée discrètement.

La vidéo de la campagne est jointe de la même manière qu’une vidéo Instagram ou TikTok. Utilisez une vidéo du tableau, ou collez un lien public. Le nom de la campagne devient le titre de la vidéo. Le texte de la publication et le lien de la campagne deviennent la description.

## Sa place dans la méthode

Chaque tableau suit le même arc : **Idée → Réaliser → Exécuter → Mesurer → Portée**. La Portée est la dernière étape, et c’est celle qui a le plus de chances de se dérouler ailleurs : dans un outil de planification, un onglet de studio, un dossier d’exports. Une fois qu’elle s’éloigne du tableau, la trace de ce qui est parti s’en va avec elle.

```bf-figure
{
  "kind": "compare",
  "title": "Faire sortir une vidéo de lancement",
  "columns": [
    { "title": "Avant", "hue": "muted", "items": ["Rendre sur le tableau", "Télécharger le fichier", "Ouvrir YouTube Studio", "L’envoyer à nouveau", "Y coller la description", "Reposter le lien à la main", "Rien sur le tableau ne sait qu’elle est sortie"] },
    { "title": "Maintenant", "hue": "reach", "items": ["Rendre sur le tableau", "Cocher YouTube sur la campagne", "La regarder monter à côté des autres réseaux", "Le lien atterrit sur la campagne"] }
  ],
  "caption": "La vidéo part avec la campagne à laquelle elle appartient : son résultat se trouve donc à côté de X, LinkedIn et Instagram. Vous voyez quelles publications sont en ligne, et où, sans avoir à demander."
}
```

Mesurer et la Portée partagent une boucle. Les vues de la chaîne étaient déjà sur le tableau, via la tuile du flux YouTube. Désormais, la vidéo qui génère ces vues part aussi du tableau : l’étape suivante, observer ses résultats, commence donc au même endroit que le lancement.

---

**À lire aussi :** [Créez des scènes vidéo et des films sur le canevas](/blog/make-video-scenes-and-movies-on-the-canvas) · [Exécutez l’application que votre tableau vient de construire](/blog/run-your-app-on-the-canvas)

[Ouvrez un canevas](/create), rendez la vidéo et envoyez-la avec le reste du lancement.
