Il existe dans Builderforce une décision de conception qui ressemble à une petite politesse d'interface et qui est en réalité celle qui porte tout le reste : **lire une idée et choisir une preuve sont séparés de la construction, et ni l'un ni l'autre ne coûte quoi que ce soit.**

Deux boutons, pas un seul. Un plan que vous pouvez examiner avant que quoi que ce soit ne se produise. C'est la différence entre un outil qui vous aide à décider et un outil qui décide à votre place tout en ayant l'air de vous aider.

```bf-figure
{
  "kind": "flow",
  "title": "Trois actes, dont deux gratuits",
  "steps": [
    { "label": "Lire", "note": "Du texte en entrée, une spécification en sortie. Aucune écriture sur le canevas, aucun ticket, aucun agent, aucun budget d'exécution.", "hue": "read", "tag": "gratuit" },
    { "label": "Prouver", "note": "Huit preuves classées au regard de cette spécification, chacune ouvrant sur la question à laquelle elle répond.", "hue": "prove", "tag": "gratuit" },
    { "label": "Créer", "note": "La preuve choisie, concrétisée. C'est le seul acte qui consomme quoi que ce soit.", "hue": "build", "tag": "payant" }
  ],
  "caption": "Si les actes qui décident si l'acte coûteux vaut la peine avaient un prix, les gens les sauteraient. Alors ils n'en ont pas."
}
```

## Premier acte : lire n'écrit rien

Collez tout. L'e-mail, le règlement du concours, la section de l'appel d'offres, le paragraphe tapé à minuit. Rien n'a besoin d'être nettoyé d'abord — nettoyer, c'est du travail, et le travail avant le premier résultat est exactement ce qui dissuade les gens d'essayer.

Ce qui revient, c'est une spécification : ce que la chose doit faire, les capacités que le texte mentionne, et les contraintes que le brief lui-même a posées. La lecture effectue d'abord une passe heuristique, puis y fusionne la lecture d'un modèle, si bien qu'un brief collé ne revient jamais vide — une spécification vierge serait impossible à distinguer d'une fonctionnalité en panne, et dans les deux cas vous partiriez.

Trois propriétés de l'étape de lecture méritent d'être énoncées, parce qu'elles sont inhabituelles :

- **Elle est idempotente et gratuite.** Lisez, modifiez deux phrases, relisez. Quatre fois. Rien ne s'accumule.
- **Elle vous montre sa lecture avant d'agir dessus.** Vous pouvez contester la spécification — ce qui n'est possible que parce que vous la voyez.
- **Relire un texte modifié écarte la lecture précédente.** Les mots à l'écran font foi. Planifier en silence à partir de l'interprétation d'hier d'un brief modifié serait un bug presque impossible à remarquer.

```bf-figure
{
  "kind": "compare",
  "title": "Ce qui se passe entre le bouton et le résultat",
  "columns": [
    {
      "title": "Les outils à un seul bouton",
      "hue": "bad",
      "items": [
        "Vous décrivez, et la construction démarre.",
        "L'interprétation n'est jamais montrée, seulement son résultat.",
        "Le choix de ce qu'il faut construire a été fait par défaut.",
        "S'arrêter veut dire tout défaire.",
        "Le premier point de contrôle honnête arrive après la dépense."
      ]
    },
    {
      "title": "Lire, puis Prouver, puis Créer",
      "hue": "good",
      "items": [
        "Vous décrivez, et vous obtenez une lecture que vous pouvez discuter.",
        "Huit options, chacune avec la question à laquelle elle répond et son coût.",
        "Le choix vous appartient, et il est explicite.",
        "S'arrêter veut dire fermer l'onglet.",
        "Le point de contrôle arrive avant toute dépense."
      ]
    }
  ]
}
```

## Deuxième acte : le sélecteur est le produit

L'écran du milieu est celui que la plupart des outils n'ont pas, et il est volontairement au centre de la surface plutôt que relégué dans un menu déroulant sur le chemin de la construction.

Chaque carte s'ouvre sur **la question à laquelle sa preuve répond**, et non sur ce qu'elle produit. Cet ordre est tout l'argument : choisir une preuve, c'est choisir la question pour laquelle vous acceptez de payer une réponse. Une carte qui s'ouvre sur « une landing page et un formulaire » vous invite à comparer des livrables. Une carte qui s'ouvre sur *« Est-ce que quelqu'un veut vraiment ça ? »* vous invite à comparer des doutes — et c'est cette comparaison-là que vous devriez faire.

Sous chacune, deux jauges : fidélité et effort, sur cinq. Cinq points se lisent plus vite qu'un paragraphe, et ces deux axes sont réellement tout ce dont dépend la décision une fois que vous savez quelle question vous posez.

La recommandation privilégie la preuve la moins chère qui convient et la marque « Commencez ici ». Elle ne commence jamais par le système complet. C'est le seul endroit où le produit a une opinion au détriment de son image de puissance — et il vaut la peine d'expliquer pourquoi. Un moteur de recommandation qui choisirait la construction complète parce qu'un brief mentionne trois intégrations ne ferait qu'approuver ce que vous aviez déjà décidé. Ce n'est pas un conseil ; c'est une machine à se sentir conforté.

## Troisième acte : ce qu'une construction produit réellement

Vient alors le second bouton, et c'est celui qui consomme.

```bf-figure
{
  "kind": "stack",
  "title": "Une construction, cinq résultats",
  "bands": [
    { "label": "Des fichiers sur le canevas", "note": "Pages, scripts, consoles et chartes — de vrais objets dans votre projet, modifiables, pas un aperçu.", "hue": "make" },
    { "label": "Des endpoints en service", "note": "Des handlers qui répondent à votre adresse d'entrée dès leur enregistrement. Aucun écart entre ce qui est déployé et ce qui est visible.", "hue": "make" },
    { "label": "Des tickets sur le tableau", "note": "Créés de manière idempotente, répartis entre configuration humaine et construction par agent. Les tickets de construction sont proposés à la porte de la voie autonome.", "hue": "run" },
    { "label": "Un site publié", "note": "Tout le canevas, pas seulement cette passe — un projet accumule des preuves, et la publication remplace le site.", "hue": "run" },
    { "label": "Une adresse", "note": "Quelque chose que vous pouvez envoyer à quelqu'un. C'est ce que « réel » veut dire, concrètement.", "hue": "measure", "tag": "l'essentiel" }
  ],
  "caption": "Plus une liste de préparation : ce qu'il manque encore pour que cela fonctionne, réparti entre bloquant et facultatif, avec le lien vers la console pour chaque élément."
}
```

Plusieurs de ces résultats portent des leçons qui ont coûté cher à apprendre.

**La publication a lieu avant la création des collections, et cet ordre est essentiel.** Une ligne de site n'existe pas avant la première publication, et la collection d'un formulaire a besoin d'un identifiant de site. Sautez l'étape de la collection et l'endpoint du formulaire renvoie une 404 — identique, octet pour octet, à une collection *fermée*. Résultat : une landing page qui affiche une demande nulle pour une idée que les gens voulaient vraiment. C'est la pire défaillance que cette fonctionnalité puisse connaître, et c'est un bug d'ordre, pas de logique.

**Les webhooks non vérifiés n'ont pas de valeur par défaut.** Un endpoint public qui ne vérifie pas son appelant permet à n'importe qui de forger un message client et de dépenser le solde de votre compte. La vérification est donc obligatoire plutôt que proposée par défaut, et un secret manquant échoue en mode fermé avec une 403 — c'est un système fonctionnel qui refuse une requête non authentifiée, pas une panne.

**Une étape en échec renvoie quand même une réponse bien formée.** Une 500 envoyée à un opérateur de téléphonie coupe l'appel. Chez un fournisseur de commerce, dix-neuf échecs consécutifs suppriment purement et simplement l'abonnement. Une étape qui échoue se lie donc à une valeur vide et le handler répond malgré tout, en mode dégradé et honnête, plutôt que de faire tomber l'intégration pour signaler un problème.

## La conséquence sur les prix

Cette structure a une conséquence tarifaire qu'il vaut mieux dire franchement plutôt que l'enterrer dans un tableau : **Lire et Prouver sont gratuits sur toutes les offres.** Seul Créer consomme du budget d'exécution.

Ce n'est pas de la générosité. C'est la seule tarification cohérente avec la méthode. Si décider coûtait de l'argent, les gens décideraient moins — et décider moins est précisément l'échec que toute la démarche existe pour éviter.

## Là où la boucle se referme

Créer n'est pas la fin. Chaque preuve a emporté une condition d'arrêt dans la construction — un seuil, un taux de réussite, un taux de complétion, une date de sortie — et ce chiffre est évalué dans Mesurer. La réponse retourne ensuite à Idée, et vous lisez la version suivante du brief en sachant quelque chose que vous ignoriez auparavant.

Trois actes, répétés, voilà ce qu'est la méthode. Un seul passage, ce n'est qu'un projet.

---

*Essayez-le sur un vrai sujet : [ouvrez un canevas](/create/new) et décrivez l'idée ; une fois connecté, `/realize` la lit et vous montre le classement. À lire aussi : [Huit façons de concrétiser une idée](/blog/eight-ways-to-make-an-idea-real) et [De l'idée au réel, la méthodologie opérationnelle](/blog/idea-to-real-the-operating-methodology).*
