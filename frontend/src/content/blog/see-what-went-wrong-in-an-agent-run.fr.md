Vous demandez à l'agent de l'éditeur quelques visualisations de plus. Treize minutes et demie plus tard, il a effectué treize modifications, le compteur de tokens a dépassé les trois millions, et quelque chose dans le dernier fichier qu'il a touché ne compile plus. Vous l'arrêtez.

Puis vous essayez de comprendre ce qui s'est passé, et vous n'y arrivez pas. L'exécution n'a pas planté, il n'y a donc aucune erreur à lire. Le modèle a répondu à chaque tour, donc rien n'a expiré. Le rapport de diagnostic a examiné l'ensemble et n'a renvoyé qu'un mot : **Non concluant**.

Cette exécution est réelle. Ensuite, nous avons rejoué à la main sa trace enregistrée, et tous les problèmes y étaient : 21 tours de lecture avant la première modification, 13 tours qui ont chacun fait exactement une modification tout en renvoyant environ cent mille tokens de conversation, pas une seule vérification de types ni un seul test, et une modification qui fermait un objet une accolade trop tôt. Tout avait été enregistré, et rien ne l'avait signalé.

## Le tiroir Agent runs

Le Visualizer de VS Code dispose désormais d'un tiroir **Agent runs**. Il liste vos exécutions récentes de l'agent de l'éditeur pour le projet que vous consultez. Choisissez-en une : il lit l'exécution enregistrée et vous dit ce qui n'a pas fonctionné.

```bf-figure
{
  "kind": "screen",
  "frame": "Visualizer · Agent runs",
  "ratio": 1.62,
  "regions": [
    { "label": "Exécutions récentes", "note": "Chacune avec ses modèles, son nombre de tours et ses constats par gravité", "x": 3, "y": 6, "w": 24, "h": 88, "hue": "idea" },
    { "label": "Bande des tours", "note": "Une barre par tour : lecture, écriture, forcé ou échoué. La hauteur correspond aux tokens de prompt", "x": 30, "y": 6, "w": 67, "h": 22, "hue": "run" },
    { "label": "Constats", "note": "Ce qui n'a pas fonctionné, le plus grave en premier, chacun avec son tour, son outil et son fichier", "x": 30, "y": 32, "w": 42, "h": 62, "hue": "measure" },
    { "label": "Fichiers touchés", "note": "Écrits ou vérifiés, à un clic de la carte des connaissances", "x": 75, "y": 32, "w": 22, "h": 62, "hue": "make" }
  ],
  "caption": "L'exécution qui affichait autrefois Non concluant : une longue étendue plate de tours de lecture, puis une rangée de fins tours à écriture unique, chacun haut de tokens de prompt, et aucune vérification nulle part dans la bande."
}
```

Il ne résume pas à l'aide d'un modèle. Chaque constat provient d'une vérification fixe sur les tours enregistrés : la même exécution donne donc toujours les mêmes constats, et chacun vous montre d'où il vient.

- **Une analyse sans fin :** de nombreux tours en lecture seule avant la première modification, et si le budget du plan a dû forcer le passage de relais.
- **Prêt, mais sans agir :** l'agent a dit qu'il était prêt, puis a continué à lire.
- **Une écriture par tour :** une série de tours qui ont chacun fait une seule modification, avec les tokens de prompt qu'ils ont coûtés à eux tous.
- **Prompt gonflé :** la quantité de prompt envoyée par l'exécution pour chaque token qu'elle a renvoyé, et le coût de chaque modification.
- **Écrit, jamais vérifié :** des fichiers modifiés sans aucun appel de vérification de types, de test, de lint ou de diagnostic ensuite.
- **Équilibre des accolades rompu :** une modification dont le nouveau texte ouvrait ou fermait plus d'accolades, de crochets ou de parenthèses que le texte qu'il remplaçait.
- **Réécritures en boucle :** le même fichier réécrit encore et encore.
- **Créé en ticket, puis fait sur place :** des tickets créés pendant l'exécution, jamais confiés à personne, puis réalisés par la session elle-même.
- **Tours lents et surdimensionnés :** des tours de plus d'une minute, et des appels d'outils transportant des kilo-octets d'arguments répétés.
- **Arrêté sans vérification :** l'exécution s'est terminée sur votre Stop avec des modifications non vérifiées encore en suspens.

Sur l'exécution ci-dessus, le tiroir relève 13 constats. Plus rien ne revient Non concluant.

```bf-figure
{
  "kind": "compare",
  "title": "La même exécution, lue de deux façons",
  "columns": [
    { "title": "Avant", "hue": "muted", "items": ["13 min 38 s, 3,06 M tokens de prompt", "Arrêtée à la main", "Rapport : Non concluant", "Ouvrez la trace et comptez les tours vous-même"] },
    { "title": "Dans le tiroir Agent runs", "hue": "measure", "items": ["21 tours de lecture avant la première écriture ; le budget du plan a forcé le passage de relais", "13 tours à écriture unique et le prompt qu'ils ont renvoyé", "Chaque fichier écrit, aucun vérifié", "labels.ts : une accolade fermée trop tôt, au tour et à la modification qui l'ont causée", "Arrêtée avec des modifications non vérifiées", "13 constats au total, chacun avec sa preuve"] }
  ],
  "caption": "Rien de nouveau n'a été enregistré. Chaque constat se trouvait déjà dans la trace ; le tiroir est ce qui la lit."
}
```

## L'agent le repère aussi pendant le tour

Un tiroir qui explique une mauvaise exécution après coup, c'est utile. C'est mieux si l'exécution ne tourne pas mal. L'agent de l'éditeur reçoit donc désormais deux signaux à chaque modification :

```bf-figure
{
  "kind": "flow",
  "title": "Ce qu'une modification renvoie désormais",
  "steps": [
    { "label": "Modification", "note": "L'agent modifie un fichier.", "hue": "make" },
    { "label": "Diagnostics", "note": "Les erreurs du serveur de langage pour ce fichier reviennent dans le résultat même de la modification, à côté de toute autre note sur ce résultat.", "hue": "run" },
    { "label": "Équilibre", "note": "Si la modification a ouvert ou fermé plus de parenthèses ou d'accolades qu'elle n'en a remplacé, le résultat le signale, même sans vérificateur configuré.", "hue": "run" },
    { "label": "Tour suivant", "note": "L'agent répare le fichier qu'il vient de casser au lieu de construire par-dessus.", "hue": "measure", "tag": "même exécution" }
  ],
  "caption": "L'accolade qui a cassé labels.ts serait désormais signalée sur la modification qui l'a cassée, et non découverte par une personne à la fin de l'exécution."
}
```

## Ce que vous pouvez en faire dès aujourd'hui

- **Ouvrez n'importe quelle exécution récente de l'agent de l'éditeur** et voyez, en quelques secondes, où sont passés son temps et ses tokens.
- **Désignez le tour, l'outil et le fichier** derrière chaque problème au lieu de le décrire de mémoire.
- **Voyez quels fichiers une exécution a modifiés sans jamais les vérifier**, et passez de n'importe lequel d'entre eux à la carte des connaissances.
- **Laissez l'agent repérer ses propres modifications cassées** : les erreurs du serveur de langage et un avertissement sur les accolades reviennent sur la modification elle-même.

## Sa place dans la méthode

Idea to Real parcourt Idea, Make, Run et Measure, et la boucle interne est [Read, Prove, Build](/blog/read-prove-build-the-inner-loop) : comprendre ce qui existe, prouver l'hypothèse à moindre coût, puis investir dans la construction. Nous l'exigeons du travail, et l'agent qui fait le travail devrait répondre à la même exigence.

Une exécution d'agent est une construction, et jusqu'ici elle n'avait pas de Measure. Vous pouviez voir qu'elle s'était terminée ou que vous l'aviez arrêtée, mais pas si elle avait lu trop longtemps, écrit sans vérifier ou cassé quelque chose en chemin. Le tiroir Agent runs est le Measure de l'agent, et les vérifications qu'il exécute sont des preuves sur l'exécution enregistrée. Un constat dit ce qui s'est passé, à quel tour, dans quel fichier. Les diagnostics au moment de la modification et l'avertissement sur les accolades déplacent une partie de cette preuve à l'intérieur de l'exécution, sur l'étape qui, sinon, aurait échoué en silence.

```bf-figure
{
  "kind": "compare",
  "title": "Measure, appliqué à l'agent",
  "columns": [
    { "title": "Read", "hue": "idea", "items": ["Combien de tours ont été consacrés à la lecture", "Si l'état de préparation annoncé a tenu"] },
    { "title": "Prove", "hue": "measure", "items": ["Chaque fichier écrit est suivi d'une vérification, ou d'un constat", "Chaque modification garde ses accolades équilibrées, ou le signale sur-le-champ"] },
    { "title": "Build", "hue": "make", "items": ["Ce que chaque modification a coûté en tokens de prompt", "Si les tickets créés ont été confiés à quelqu'un ou faits sur place"] }
  ],
  "caption": "Les trois mêmes questions que nous posons avant de construire quoi que ce soit, posées à l'exécution qui a fait la construction."
}
```

---

**À lire aussi :** [Read, Prove, Build : la boucle interne](/blog/read-prove-build-the-inner-loop) · [Un agent, un noyau](/blog/one-agent-one-kernel) · [Mettez en paquet les connaissances prouvées par votre revue](/blog/portable-knowledge-packs)

Ouvrez le Visualizer dans VS Code, ouvrez **Agent runs** et choisissez la dernière exécution qui ne s'est pas déroulée comme prévu.
