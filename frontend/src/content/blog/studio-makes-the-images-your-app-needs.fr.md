# Studio crée les images dont votre application a besoin

> **Mise à jour du 4 octobre 2026 :** vous voyez désormais chaque image et chaque clip vidéo *avant* qu’il n’entre dans votre application. Le panneau Médias montre ce que l’agent a créé et attend que vous choisissiez **L’utiliser**, **Réessayer** ou **Écarter**. Voir « Vous le voyez d’abord » ci-dessous.

Vous demandez une page d’atterrissage pour une boulangerie de quartier. La mise en page est juste, le texte est juste et la section du menu fonctionne. L’image d’en-tête est une boîte grise avec « 1200 × 600 » au milieu.

Ou c’est pire : l’agent n’a pas voulu laisser de vide, alors il a écrit de mémoire un lien vers une photo libre de droits. Il se charge aujourd’hui, peut-être. Puis il ne se charge plus, et la première chose que voit quiconque sur votre site est une icône d’image cassée.

Jusqu’ici, chaque application que Studio construisait avait ce défaut. L’agent savait écrire du code mais ne pouvait pas créer d’image : la partie la plus visible d’un premier jet était donc toujours la moins finie.

## L’agent crée l’image

L’agent de Studio dispose désormais d’un outil d’image. Quand la page a besoin d’une image d’en-tête, d’une illustration, d’une photo de produit ou d’un arrière-plan, l’agent décrit l’image qu’il veut et en obtient une. Cette description couvre le sujet, le style, la palette et la composition. Il choisit aussi la forme : carrée, large pour une bannière ou haute pour un écran de téléphone. Puis il place l’image là où elle doit être : dans une balise `<img>`, un arrière-plan CSS ou la balise d’aperçu social.

```bf-figure
{
  "kind": "flow",
  "title": "De « il faut une image d’en-tête » à une image dans la page",
  "steps": [
    { "label": "L’agent la décrit", "note": "« Devanture chaleureuse de boulangerie à l’aube, lumière douce, bannière large. »", "hue": "idea" },
    { "label": "L’image est créée", "note": "Générée pour correspondre à la description, dans la forme dont la mise en page a besoin.", "hue": "make" },
    { "label": "Stockée dans votre espace de travail", "note": "Enregistrée une fois, avec un lien permanent : rien n’expire, et rien ne pointe vers le serveur de quelqu’un d’autre.", "hue": "make", "tag": "lien permanent" },
    { "label": "Écrite dans le code", "note": "Le lien est placé dans la balise img ou la feuille de style, et l’aperçu l’affiche.", "hue": "run" }
  ],
  "caption": "L’agent utilise l’outil de lui-même chaque fois qu’une mise en page a besoin d’une image ; vous pouvez aussi en demander une explicitement."
}
```

L’image est enregistrée dans votre espace de travail avant que l’agent ne l’utilise. Vous n’obtenez jamais un lien vers un fichier temporaire d’un fournisseur, qui peut disparaître en une heure, ni un blob en ligne qui gonfle vos fichiers sources. L’aperçu affiche l’image immédiatement, et elle reste en place après la publication.

## Ce qui change dans un premier jet

```bf-figure
{
  "kind": "compare",
  "title": "La page d’atterrissage de la boulangerie, premier jet",
  "columns": [
    { "title": "Avant", "hue": "muted", "items": ["Des boîtes grises de substitution avec des tailles en pixels dedans", "Des liens de photos libres de droits devinés de mémoire, dont certains cassés", "Des commentaires « Remplacez par votre image » dans le code", "Un jet qui paraît inachevé : personne ne juge donc la mise en page"] },
    { "title": "Maintenant", "hue": "make", "items": ["Une image d’en-tête qui correspond au brief", "Des photos de produits dans la section du menu, dans un style cohérent", "Des liens permanents dans le code, stockés dans votre espace de travail", "Un jet qui ressemble au produit final"] }
  ],
  "caption": "Même prompt, même mise en page. La différence tient à ce que la page puisse être jugée telle qu’elle aura réellement l’air."
}
```

Changer une image fonctionne comme changer n’importe quoi d’autre dans Studio. Dites « fais de l’image d’en-tête une prise de vue du soir, lumières allumées » et l’agent crée une nouvelle image et remplace le lien. Le tour est enregistré comme une version : l’ancienne image est à une restauration de distance.

## Vous le voyez d’abord

Une image est une décision de goût, et l’agent ne devrait pas la prendre seul. Quand l’agent génère désormais une image ou un clip vidéo, il ne l’écrit pas immédiatement dans la page. Le **panneau Médias** s’ouvre à côté de votre application avec la nouvelle image, et l’agent attend votre réponse.

```bf-figure
{
  "kind": "screen",
  "frame": "Studio avec le panneau Médias ouvert",
  "ratio": 1.62,
  "regions": [
    { "label": "Brain", "note": "L’agent a demandé une image d’en-tête et attend votre réponse", "x": 2, "y": 8, "w": 24, "h": 86, "hue": "idea" },
    { "label": "Votre application", "note": "Inchangée tant que vous n’avez pas décidé", "x": 28, "y": 8, "w": 44, "h": 86, "hue": "run" },
    { "label": "L’utiliser · Réessayer · Écarter", "note": "La nouvelle image en taille réelle, avec son prompt à modifier", "x": 74, "y": 8, "w": 24, "h": 44, "hue": "make" },
    { "label": "Médias de ce projet", "note": "Tout ce qui a été généré jusqu’ici, à réutiliser ou à copier", "x": 74, "y": 56, "w": 24, "h": 38, "hue": "accent" }
  ],
  "caption": "L’agent n’écrit le lien dans votre code qu’après que vous avez choisi L’utiliser. Réessayer refait le rendu avec le prompt tel que vous l’avez modifié, sans nouvel aller-retour par la discussion."
}
```

- **L’utiliser :** l’agent la place dans l’application, et le panneau la marque comme utilisée.
- **Réessayer :** modifiez le prompt si vous le souhaitez, et une nouvelle version prend sa place.
- **Écarter :** rien n’entre dans l’application, et l’agent demande ce que vous voudriez à la place.

Vous pouvez aussi générer vous-même depuis le panneau, des images ou des clips vidéo, en paysage, carré ou portrait. Tout ce qui est créé pour le projet reste dans sa médiathèque. Cliquez sur **Utiliser dans l’application** sur n’importe quel élément et la discussion reçoit une demande toute prête ; il vous suffit de dire où il va.

## Sa place dans la méthode

Le travail sur Builderforce suit un arc — **Idée → Réaliser → Exécuter → Mesurer** — et chaque acte passe par la même boucle intérieure : [Lire, Prouver, Construire](/blog/read-prove-build-the-inner-loop).

Les images relèvent de l’acte **Réaliser**, et elles comptent le plus à l’étape **Prouver**. Vous prouvez un jet en le montrant à quelqu’un : un cofondateur, un client, le propriétaire de la boulangerie. Les gens réagissent à l’apparence d’une page avant de réagir à son fonctionnement. Une mise en page pleine de substituts leur demande d’imaginer la page finie, et la plupart des gens jugent les boîtes. Avec de vraies images dedans, un premier jet suscite les réactions que vous avez besoin d’entendre.

Elles gardent aussi **Construire** à un seul endroit. Auparavant, finir une page signifiait quitter Studio pour chercher, télécharger, téléverser et coller des liens. Désormais, les images viennent de la même conversation que le code, et elles sont stockées là où l’application peut toujours les atteindre.

## Ce que vous pouvez en faire dès aujourd’hui

- **Voir chaque image et chaque clip avant que votre application ne le voie** : l’utiliser, réessayer ou l’écarter dans le panneau Médias.
- **Demander une page et obtenir ses images** : illustrations d’en-tête, illustrations, photos de produits et arrière-plans, conçus pour s’adapter à la mise en page.
- **Changer une image en décrivant le changement**, et restaurer la précédente depuis Versions si vous la préfériez.
- **Publier sans corriger les liens d’images** : chaque image générée est stockée dans votre espace de travail avec un lien permanent.

Les images générées utilisent vos crédits d’images quotidiens, le même quota que les images créées sur le canevas.
