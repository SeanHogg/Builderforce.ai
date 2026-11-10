# Vous ne lisez plus le code de l'agent. Vous pouvez maintenant voir ce qu'a fait son exécution

Une exécution de l'agent se termine. Quarante fichiers modifiés, les tests au vert, et le résumé indique « Terminé, tous les tests passent ». Ouvrez-vous le diff ?

La plupart des gens ne le font plus, et c'est tout l'intérêt d'avoir un agent. Mais ne pas lire le code n'a jamais voulu dire se désintéresser de ce qui lui est arrivé. Quelque part dans ces quarante fichiers, une route a peut-être perdu sa vérification d'authentification. Une boucle attend peut-être désormais la base de données une fois par élément. Un test qui échouait a peut-être été marqué `.skip`, et « tous les tests passent » serait vrai.

Le diff peut vous apprendre tout cela, si vous le lisez et si vous savez quoi chercher. Le résumé de l'exécution, lui, est écrit par l'agent même dont vous essayez de juger le travail. Jusqu'ici, il n'y avait rien entre les deux.

## La carte des écarts de l'exécution

Chaque exécution de l'agent dans le chat VS Code se termine désormais par une carte des **écarts de l'exécution**. Elle ne lit pas le diff pour le résumer. Elle réduit en faits le code d'avant l'exécution et celui d'après, compare les deux ensembles et rend un verdict sur quatre questions.

```bf-figure
{
  "kind": "screen",
  "frame": "Chat VS Code · fin d'une exécution",
  "ratio": 1.5,
  "regions": [
    { "label": "Titre", "note": "Moins bon : sécurité (1 × la route a perdu son garde d'authentification) ; qualité (tests affaiblis)", "x": 4, "y": 6, "w": 92, "h": 14, "hue": "measure" },
    { "label": "Sécurité", "note": "Moins bon · 1 nouveau", "x": 4, "y": 24, "w": 44, "h": 13, "hue": "measure" },
    { "label": "Performance", "note": "Inchangé · analyse statique uniquement", "x": 52, "y": 24, "w": 44, "h": 13, "hue": "run" },
    { "label": "Qualité", "note": "Moins bon · tests affaiblis", "x": 4, "y": 41, "w": 44, "h": 13, "hue": "measure" },
    { "label": "Caractéristiques qualité", "note": "Compatibilité, maintenabilité, sûreté ; le reste Non mesuré", "x": 52, "y": 41, "w": 44, "h": 13, "hue": "idea" },
    { "label": "Rayon d'impact : moyen", "note": "Comparé aux exécutions passées de ce dépôt", "x": 4, "y": 60, "w": 56, "h": 14, "hue": "accent" },
    { "label": "Voir les détails", "x": 64, "y": 60, "w": 32, "h": 14, "hue": "make" },
    { "label": "Bloque la finalisation d'une exécution autonome", "note": "Affiché quand un garde a été retiré ou des tests affaiblis", "x": 4, "y": 80, "w": 92, "h": 14, "hue": "measure" }
  ],
  "caption": "Un titre, une ligne par dimension, une bande de rayon d'impact et un accès aux preuves. Chaque verdict est un mot et une icône, pas seulement une couleur."
}
```

**Sécurité.** La surface d'attaque a-t-elle changé ? Une route qui a perdu son garde d'authentification, un nouveau point d'entrée, une nouvelle capacité système comme un import de `child_process`, une cryptographie faible, un secret ajouté au code. Le secret est affiché masqué, pas recopié tel quel.

**Performance.** L'exécution a-t-elle ajouté un appel d'E/S attendu avec await dans une boucle, ou un appel d'E/S bloquant ? Ce sont des règles statiques, et la ligne indique « analyse statique uniquement » pour ne pas passer pour un benchmark.

**Qualité.** Le code s'est-il dégradé, et l'agent a-t-il **affaibli les tests qui le jugent** ? Un test ignoré ou supprimé, un `.only` ajouté, moins d'assertions, un matcher plus permissif, une vérification lint ou de types désactivée, un délai d'attente relevé. Quand cela arrive, le titre dit que les tests ont été affaiblis, en ces termes.

**Les caractéristiques qualité**, selon l'ISO/IEC 25010. Compatibilité : une API exportée a été cassée, ou une nouvelle est apparue. Maintenabilité : un nouveau cycle de dépendances, une couche franchie, un groupe de code dupliqué qui a grossi, du code inutilisé, un fichier surdimensionné qui a encore grandi. Sûreté : une modification de schéma destructrice, un force push ou une suppression récursive dans un script. Les caractéristiques que la carte ne mesure pas encore indiquent **Non mesuré**. Elles ne sont pas affichées à zéro, parce que zéro serait une affirmation.

## Comment un verdict est rendu

```bf-figure
{
  "kind": "flow",
  "title": "D'une exécution terminée à un verdict",
  "steps": [
    { "label": "Exécution", "note": "L'agent termine. Le code d'avant et le code d'après sont les deux côtés.", "hue": "run" },
    { "label": "Faits", "note": "Chaque côté est réduit en faits et en constats par des extracteurs et des règles fixes, les mêmes des deux côtés.", "hue": "make" },
    { "label": "Écarts", "note": "Les deux ensembles sont comparés. Chaque constat est nouveau dans cette exécution, résolu ou modifié par elle, ou déjà présent.", "hue": "idea" },
    { "label": "Verdict", "note": "Meilleur, Moins bon, Inchangé, Non comparable ou Non mesuré, par dimension, avec un titre construit à partir d'une phrase fixe.", "hue": "measure", "tag": "fin de l'exécution" }
  ],
  "caption": "On compare des faits, pas du texte. Le même avant et le même après donnent la même empreinte sur n'importe quelle machine, et aucun modèle n'écrit le verdict."
}
```

Quelques règles gardent la carte honnête :

- **Cinq verdicts, pas deux.** Meilleur, Moins bon, Inchangé, Non comparable et Non mesuré. Si les deux côtés ne peuvent pas être comparés équitablement, par exemple parce que la branche a changé pendant l'exécution, la carte indique Non comparable et pourquoi, au lieu de deviner.
- **≈ signale une heuristique.** Un constat issu d'une heuristique plutôt que d'une règle exacte porte un ≈, pour que vous sachiez quels chiffres sont des estimations.
- **Le rayon d'impact est relatif.** Faible, moyen ou élevé est établi par rapport aux exécutions passées de votre propre dépôt : « élevé » veut dire élevé pour ce code, pas en comparaison avec celui des autres.
- **Elle ne gêne pas.** La carte est calculée sur votre machine, hors ligne et sans connexion à un compte, et elle ne fait ni échouer ni ralentir l'exécution qu'elle décrit.

## Voir les détails

**Voir les détails** ouvre un panneau latéral au-dessus du chat. Les constats sont regroupés par dimension, puis par origine : nouveaux dans cette exécution, résolus par cette exécution, modifiés par cette exécution, déjà présents. Chacun a ses preuves et un lien **Ouvrir le code** vers la ligne concernée.

```bf-figure
{
  "kind": "compare",
  "title": "La même exécution, avant et après la carte",
  "columns": [
    { "title": "Ce que vous aviez", "hue": "muted", "items": ["« Terminé, tous les tests passent »", "Un diff de quarante fichiers", "Votre propre intuition sur ce qui compte dedans"] },
    { "title": "Ce que dit la carte", "hue": "measure", "items": ["Sécurité : Moins bon · la route a perdu son garde d'authentification", "Performance : Inchangé · analyse statique uniquement", "Qualité : Moins bon · test ignoré, moins d'assertions", "Fiabilité : Non mesuré", "Rayon d'impact : moyen"] }
  ],
  "caption": "« Tous les tests passent » était vrai. C'était vrai parce que l'un d'eux ne s'exécutait plus."
}
```

Pour les exécutions autonomes, où personne ne regarde le chat, un garde d'authentification retiré et des tests affaiblis sont signalés comme **bloquants**. Ce sont les deux moyens qu'a un agent de faire passer son propre travail pour terminé.

La carte, le panneau et chaque constat existent en anglais, chinois, espagnol, français et allemand.

## Sa place dans la méthode

Idea to Real parcourt **Idea, Make, Run et Measure**. La boucle interne, [Read, Prove, Build](/blog/read-prove-build-the-inner-loop), vous fait passer d'Idea à Make : comprendre ce qui existe, prouver l'hypothèse à moindre coût, puis investir dans la construction. La boucle se referme dans Measure, qui pose une seule question : est-ce que ça marche ?

Une exécution d'agent est une construction, et jusqu'ici son Measure était la parole de l'agent lui-même. Des tests au vert prouvaient que les tests restants passaient. Les écarts de l'exécution sont le Measure de l'exécution : la preuve qu'elle a rendu les choses **meilleures**, pas seulement différentes. Elle se lit comme une preuve : elle dit ce qu'elle a vérifié, ce qu'elle n'a pas pu vérifier, et montre les éléments derrière chaque verdict.

```bf-figure
{
  "kind": "compare",
  "title": "Measure, appliqué à une exécution",
  "columns": [
    { "title": "Read", "hue": "read", "items": ["Le code d'avant l'exécution, réduit en faits", "Les mêmes extracteurs des deux côtés"] },
    { "title": "Prove", "hue": "prove", "items": ["Un verdict par dimension, issu de règles et non d'un modèle", "Non mesuré tant qu'il n'existe pas de règle", "Les tests que l'agent a affaiblis, nommés comme tels"] },
    { "title": "Build", "hue": "build", "items": ["Ce que l'exécution a changé, et si c'était une amélioration", "Bloquant pour les exécutions autonomes quand des gardes ou des tests ont été affaiblis"] }
  ],
  "caption": "Les trois questions que nous posons avant de construire quoi que ce soit, posées à l'exécution qui a construit."
}
```

## Ce que vous pouvez en faire dès aujourd'hui

- **Savoir ce qu'a fait une exécution sans lire son diff :** quatre verdicts et un titre, à la fin de l'exécution qui les a produits.
- **Surprendre un agent qui corrige sa propre copie :** les tests ignorés, supprimés ou assouplis sont nommés dans le titre.
- **Voir un garde d'authentification perdu ou un nouvel import de `child_process`** dès la fin de l'exécution, pas lors d'une revue ultérieure.
- **Passer d'un verdict à la ligne de code** avec Voir les détails et Ouvrir le code.
- **L'utiliser dans un avion :** elle fonctionne hors ligne et sans connexion à un compte.

Prochaine étape : la même carte arrive sur les exécutions du web et du canevas, avec une vue de tendance des verdicts au fil des exécutions d'un projet.

---

**À lire aussi :** [L'exécution de l'agent a « fonctionné ». Vous pouvez maintenant voir ce qui a mal tourné](/blog/see-what-went-wrong-in-an-agent-run) · [Read, Prove, Build : la boucle interne](/blog/read-prove-build-the-inner-loop) · [Un agent, un noyau](/blog/one-agent-one-kernel)

Lancez un agent dans le chat VS Code et lisez la carte à la fin avant de lire quoi que ce soit d'autre.
