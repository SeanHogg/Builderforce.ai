Demandez à un agent de modifier la façon dont les sessions expirent, et observez ce qu'il fait vraiment. Il liste un répertoire. Il lit un fichier qui s'avère être le mauvais. Il cherche `expiry`, obtient quarante résultats, en lit quatre, cherche à nouveau `ttl`, trouve enfin le bon au sixième essai. Puis — vingt tours plus tard, la réponse enfin en main — il s'attaque à la modification que vous lui avez demandée.

Chacune de ces impasses est toujours dans son contexte. Le mauvais fichier y figure en entier. La recherche aux quarante résultats aussi. Au moment où l'agent atteint la partie qui exige du discernement, cette partie se dispute la place avec un listing de répertoire lu par erreur.

Ce n'est pas un problème de réflexion. C'est un problème de rangement.

## Qu'est-ce qu'un sous-agent

Un sous-agent est un second agent qui mène la recherche **dans son propre contexte** et rapporte une seule réponse.

```bf-figure
{
  "kind": "flow",
  "title": "Une délégation, du début à la fin",
  "steps": [
    { "label": "Brief", "note": "Le parent rédige une instruction complète — l'enfant ne voit rien de la conversation du parent, le brief doit donc se suffire à lui-même.", "hue": "idea" },
    { "label": "Recherche", "note": "L'enfant lit, lance des greps et raisonne sur sa propre transcription, avec un petit budget strict. Ses impasses n'appartiennent qu'à lui.", "hue": "make" },
    { "label": "Réponse", "note": "Un seul paragraphe revient : chemins exacts, noms exacts, et un « introuvable » explicite quand c'est le résultat honnête.", "hue": "prove" }
  ],
  "caption": "Le parent paie un paragraphe au lieu de vingt tours. Ce à quoi ces tours ont servi n'entre jamais dans son contexte."
}
```

L'isolement est tout l'intérêt. Un enfant qui partagerait la conversation du parent ne serait qu'une façon plus coûteuse de jouer un tour de plus.

```bf-figure
{
  "kind": "compare",
  "title": "La même tâche, à vingt tours d'écart",
  "columns": [
    { "title": "Chercher soi-même", "hue": "muted", "items": ["Lister le répertoire", "Lire le mauvais fichier, en entier", "Chercher — quarante résultats", "En lire quatre", "Chercher à nouveau", "Trouver au sixième essai", "Commencer à réfléchir, avec tout cela encore dans la fenêtre"] },
    { "title": "Déléguer la recherche", "hue": "make", "items": ["Demander : où se gère l'expiration des sessions ?", "Lire un paragraphe", "Commencer à réfléchir"] }
  ],
  "caption": "Le même travail est fait. La différence, c'est l'agent qui le porte ensuite."
}
```

## En lecture seule par défaut — et en écriture quand vous le décidez

Une délégation est en lecture seule par défaut, car une délégation non précisée est presque toujours une investigation. L'enfant peut lire, chercher et raisonner, et un enfant en lecture seule ne peut vous coûter que du temps.

C'est un réglage par défaut, pas un plafond. Un agent qui a trouvé les quatorze fichiers nécessitant la même modification mécanique peut demander un enfant qui l'effectue — et chaque écriture que cet enfant tente vous est alors soumise **à vous** d'abord, nommément, via la même invite que celle qu'utilisent les écritures de votre agent. Auto couvre les écritures d'un sous-agent exactement comme celles du parent. Un contrôle de gouvernance qui bloque un outil le bloque aussi pour l'enfant, et un contrôle qui exige une approbation l'exige toujours, même avec Auto activé, car une préférence ne peut pas lever une politique compilée. Refusez, et le refus revient à l'enfant comme un obstacle à contourner plutôt que comme une impasse.

C'est ce qui a le plus changé récemment. Avant cette livraison, un sous-agent dans votre éditeur ne pouvait que lire : l'invite d'approbation est déclenchée par le chat qui possède l'exécution, et un agent imbriqué n'avait aucun moyen de l'atteindre — la chose honnête était donc d'exécuter les enfants en lecture seule et de le dire. L'invite est désormais accessible depuis l'intérieur d'une délégation : l'enfant pose la question au lieu d'être privé de la possibilité de la poser.

Un enfant ne peut toujours pas engendrer d'enfant. Il ne s'agit pas d'un compteur de profondeur qu'il faudrait penser à décrémenter — la capacité de délégation est tout simplement absente de ce qu'on remet à un enfant, il n'a donc rien avec quoi faire de la récursion.

```bf-figure
{
  "kind": "compare",
  "title": "Ce qu'une délégation a le droit de toucher",
  "columns": [
    { "title": "L'enfant peut", "hue": "prove", "items": ["Lire et lister des fichiers", "Chercher dans l'arborescence", "Rappeler la mémoire du projet", "Chercher sur le web", "Écrire — avec votre approbation, fichier par fichier", "Répondre, une fois, en prose"] },
    { "title": "L'enfant ne peut pas", "hue": "bad", "items": ["Écrire quoi que ce soit que vous n'avez pas approuvé", "Franchir un contrôle de gouvernance", "Mettre l'exécution en pause pour un humain", "Proposer une compétence", "Engendrer un autre sous-agent"] }
  ],
  "caption": "L'acteur responsable reste le parent. Il garde chaque décision et vous gardez chaque approbation — il cesse simplement de payer pour la recherche."
}
```

## Sa place dans la méthode

[Lire vient avant Prouver, et Prouver avant Créer](/blog/read-prove-build-the-inner-loop) — et c'est l'étape Lire que cela change.

La lecture est l'acte bon marché de la méthode, jusqu'au moment où la base de code devient grande. Elle cesse alors d'être bon marché : la fenêtre de l'agent se remplit de ce qu'il a lu en chemin vers ce dont il avait besoin, et le temps qu'il arrive à Créer, il raisonne au milieu des décombres de sa propre recherche. Les équipes le ressentent comme un agent brillant sur un petit dépôt et flou sur un vrai. Il n'y est pas moins capable. Il y est plus encombré.

La délégation ramène le coût de Lire à ce qu'il vaut vraiment. La recherche a lieu à un endroit que le parent n'a pas à porter, et le parent arrive à Prouver avec de la place pour réfléchir — la seule étape où réfléchir a toujours été l'essentiel.

## Ce que vous pouvez en faire dès aujourd'hui

- **Demander à un agent de trouver quelque chose sans dépenser son contexte à le chercher.** « Où est le middleware d'authentification », « ce motif est-il utilisé ailleurs », « qu'exporte réellement ce fichier de six cents lignes » — un brief, un paragraphe.
- **En profiter partout où l'agent s'exécute.** L'éditeur, une exécution cloud, un conteneur de longue durée et un job GitHub Actions délèguent tous de la même façon — même outil, même brief, même budget —, si bien qu'une habitude prise dans l'un vaut dans tous les autres. Les deux surfaces de longue durée sont celles où cela rapporte le plus : elles disposent du shell et du checkout, exactement là où une recherche menée par l'agent lui-même coûte le plus cher à porter.
- **Envoyer une modification mécanique, pas seulement une question.** « Renomme ce symbole partout où il apparaît » est désormais une délégation, et non un rapport sur lequel vous devez ensuite agir vous-même. Vous approuvez chaque fichier au fur et à mesure.
- **Voir ce que cela a coûté.** Chaque délégation apparaît dans la chronologie de l'exécution avec son libellé, ses tours et l'indication qu'elle les a épuisés ou non — un enfant interrompu le signale au lieu de faire passer son dernier mot pour une conclusion.
