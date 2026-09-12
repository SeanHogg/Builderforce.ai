Un agent prend un ticket, comprend qu'un changement de schéma à cet endroit exige une déclaration dans un module, une migration écrite à la main et deux garde-fous exécutés dans un ordre précis, fait fusionner le tout, et termine.

Demain, un autre agent prendra le ticket de schéma suivant et redécouvrira tout cela.

C'est exactement ce que cette version vient régler. Non pas « l'agent n'était pas assez intelligent » — il l'était, deux fois. Le problème, c'est que tout ce qu'il avait compris vivait dans une transcription que personne ne lit, et que le produit n'avait aucun objet pour représenter « une procédure qui a fonctionné ici ».

## Une compétence est une procédure, et désormais un agent peut en écrire une

Les compétences existaient déjà : cinquante-quatre fournies avec le runtime, plus une marketplace. Chaque voie d'écriture passait par une personne. Les seules procédures que les agents pouvaient suivre étaient donc celles qu'un humain avait pris le temps de rédiger.

Un agent peut désormais en proposer une. La barre est volontairement haute — un résultat vérifié, c'est-à-dire un travail fusionné ou une exécution notée qui a réellement produit quelque chose — et l'invitation le dit clairement, car une étape de réflexion qui se déclenche à chaque exécution produit un catalogue d'absurdités énoncées avec aplomb.

```bf-figure
{
  "kind": "flow",
  "title": "Comment une procédure devient quelque chose que chaque agent suit",
  "steps": [
    { "label": "Exécuter", "note": "Un agent fait le travail et atteint un résultat vérifié — fusionné, ou commité avec ses vérifications au vert.", "hue": "make" },
    { "label": "Réfléchir", "note": "Avant de terminer, il distille la partie reproductible : les étapes, les commandes exactes, et comment savoir que ça a marché.", "hue": "idea" },
    { "label": "Relire", "note": "La proposition arrive sous forme de brouillon, avec l'exécution qui l'a rédigée et les preuves qu'elle a apportées. Aucun prompt n'a encore changé.", "hue": "accent", "tag": "une personne décide" },
    { "label": "Suivre", "note": "Une fois approuvée, chaque agent de l'espace de travail l'applique dès sa prochaine exécution.", "hue": "make" }
  ],
  "caption": "Trois portes, et celle du milieu est une personne. Un agent capable de publier une compétence directement serait un agent qui réécrit ce qu'on dit à tous les autres agents, de sa propre autorité, depuis une seule exécution."
}
```

Ce que vous relisez, c'est la procédure entière, pas un résumé — le corps, l'exécution qui l'a proposée, et ce que cette exécution a offert comme preuve. L'approbation est le moment où elle devient contraignante ; c'est donc le moment où vous pouvez la lire.

## Trois autres portes qui étaient verrouillées

La même passe a ouvert trois choses qui étaient construites mais inaccessibles.

**Apportez votre propre serveur d'outils.** Un client Model Context Protocol complet dormait dans la base de code — OAuth à trois branches, consentement par outil, secrets chiffrés, un relais pour que l'identifiant ne touche jamais un navigateur — sans que rien dans le produit ne l'appelle. Un tenant ne pouvait enregistrer un serveur externe qu'en appelant l'API à la main. Il y a désormais un panneau dans Paramètres › Intégrations et une commande dans l'extension VS Code, qui pilotent tous deux les mêmes routes.

**La gouvernance dans l'éditeur.** Les packs de politiques étaient appliqués aux exécutions cloud et auto-hébergées. L'éditeur disposait du code d'application, mais ne recevait jamais aucune règle : une règle qui bloquait un outil dans le cloud l'autorisait donc en silence dans VS Code. Les deux surfaces de l'éditeur résolvent désormais les mêmes règles compilées au début de chaque exécution, et refusent de démarrer un tour si la politique ne peut pas être lue.

**Orienter une exécution auto-hébergée.** Une consigne de suivi envoyée à une exécution sur site en cours était acceptée, enregistrée, puis abandonnée — remise à une session de chat dans laquelle le moteur actuel ne tourne plus. Elle atteint désormais l'exécution en cours et s'applique comme son tour suivant.

```bf-figure
{
  "kind": "compare",
  "title": "Construit ou accessible",
  "columns": [
    { "title": "Avant", "hue": "idea", "items": ["Un client MCP sans appelant", "La plomberie de politiques de l'éditeur, sans aucune règle", "Des consignes acceptées puis abandonnées", "Des exécutions visibles uniquement dans notre chronologie"] },
    { "title": "Maintenant", "hue": "make", "items": ["Enregistrez un serveur depuis les paramètres ou l'éditeur", "La même règle s'applique dans les trois modalités", "Une consigne arrive comme tour suivant de l'exécution", "Des spans dans le collecteur que vous utilisez déjà"] }
  ],
  "caption": "Quatre capacités qui existaient dans la base de code et n'existaient pour aucun de ses utilisateurs. La distance entre ces deux états, c'est toute l'histoire de cette version."
}
```

## Mesurer si tout cela a fonctionné

Deux choses ont aussi changé dans la façon de voir ce que font les agents.

Les exécutions s'exportent désormais vers votre propre collecteur OpenTelemetry, pour que le travail des agents côtoie le reste de votre système au lieu de n'exister que chez nous — avec l'état de santé de cet export affiché à côté, car un collecteur qui s'est mis à refuser des spans doit le dire plutôt que de les laisser tomber en silence.

Et la qualité des agents est désormais une série plutôt qu'une anecdote. Les signaux de qualité existants notaient tous le trafic qui arrivait, si bien qu'une évolution d'un mois sur l'autre pouvait venir des agents comme des tickets du mois. Un benchmark est un ensemble fixe de cas, noté de la même manière chaque jour, et tracé dans le temps sous forme de score et de couverture des attentes.

## Sa place dans la méthode

L'arc de l'idée au réel suit Idée → Créer → Piloter → Mesurer, et chaque étape de la méthode pose une question : **Lire** ce qui est déjà vrai, le **Prouver** à moindre coût, puis **Créer**.

Tout ce qui précède se situe à l'autre bout de cette boucle — la moitié que les équipes sautent systématiquement.

**Lire** a gagné une mémoire capable de vraiment retrouver les choses. Le rappel côté cloud était une simple correspondance de mots-clés, ou pire, un reclassement par embeddings de dix lignes choisies par autre chose que la question ; un souvenir pertinent hors de cette fenêtre était inaccessible. C'est désormais une vraie recherche sémantique fusionnée avec la branche par mots-clés, sur le même classement que le stockage auto-hébergé a toujours utilisé. Une exécution qui lit ce que les exécutions précédentes ont appris, c'est la première étape de la méthode qui fonctionne comme annoncé.

**Mesurer** en a gagné deux. Le benchmark est ce qui fait de « les agents s'améliorent-ils ? » une question qui a une réponse, et l'export est ce qui permet à cette réponse de vivre là où votre équipe regarde déjà.

Et la boucle des compétences, c'est l'arc qui se referme sur lui-même. Une exécution qui a produit une preuve notée a accompli un passage complet d'Idée → Créer → Piloter → Mesurer. La distiller en une procédure que suivra l'exécution suivante, c'est ce qui transforme une boucle en spirale : la prochaine lecture part de ce que la dernière mesure a établi, au lieu de partir de rien.

C'était depuis toujours la promesse. C'est désormais quelque chose que le produit fait.
