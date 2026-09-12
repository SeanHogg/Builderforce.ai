La plupart des logiciels pour créer des choses sont organisés autour de ce que le logiciel possède. Un menu de départements, une grille de fonctionnalités, une liste d'intégrations. Ils répondent à « qu'est-ce que ça sait faire ? », une question légitime, sans jamais répondre à celle avec laquelle la personne est réellement arrivée : *par quoi je commence ?*

Builderforce est organisé autour d'une méthode. La navigation est la méthode. Le canevas est l'endroit où la méthode s'exécute. La tarification découle de la partie de la méthode qui coûte de l'argent. Cet article, c'est cette méthode mise par écrit.

## L'arc : où vous en êtes

Il y a quatre étapes, et ce ne sont pas des départements. Ce sont des positions sur un parcours, et chaque destination du produit se trouve dans exactement l'une d'elles.

```bf-figure
{
  "kind": "stack",
  "title": "L'arc — une question par étape",
  "bands": [
    { "label": "Idée", "note": "Et si ? — le canevas, le brief, la lecture de ce que vous avez réellement dit.", "hue": "idea", "tag": "gratuit" },
    { "label": "Créer", "note": "Construisez-le. — les preuves, les projets, la main-d'œuvre qui prend en charge les tickets.", "hue": "make" },
    { "label": "Piloter", "note": "Faites-en une entreprise. — finance, revenus, équipes, support, gouvernance.", "hue": "run" },
    { "label": "Mesurer", "note": "Est-ce que ça marche ? — là où la condition d'arrêt fixée deux étapes plus tôt est évaluée.", "hue": "measure", "tag": "referme la boucle" }
  ],
  "caption": "Deux étapes supplémentaires se situent au-delà de ces quatre — Marché (vendre, acheter, recruter, être trouvé) et Développer (faire grandir l'entreprise sur cette base). C'est ce que fait une entreprise une fois qu'elle a quelque chose qui fonctionne ; elles ne font donc pas partie de la décision de se lancer."
}
```

La propriété importante de cette liste, c'est que **s'arrêter en cours de route est une utilisation complète et réussie du produit**. Quelqu'un qui publie trois landing pages et ne crée jamais d'entreprise n'a pas raté son onboarding. Les étapes suivantes restent visibles en permanence — atténuées, pas masquées — parce que personne ne réclame une capacité qu'il n'a jamais vue.

## La boucle : ce que vous faites

Au passage de l'étape Idée à l'étape Créer se trouve quelque chose de beaucoup plus petit, et c'est la partie qui porte une opinion.

```bf-figure
{
  "kind": "flow",
  "title": "Lire → Prouver → Créer",
  "steps": [
    { "label": "Lire", "note": "Collez une idée, un brief, un appel d'offres, un concours. Il revient sous forme de spécification : ce qu'il faut faire, les capacités mentionnées, les limites posées par le brief lui-même.", "hue": "read", "tag": "n'écrit rien" },
    { "label": "Prouver", "note": "Huit façons de le concrétiser, classées au regard de cette spécification, de la moins chère à la plus chère. Chacune porte une condition d'arrêt — le chiffre qui arrêterait le projet.", "hue": "prove", "tag": "ne construit rien" },
    { "label": "Créer", "note": "Des fichiers sur le canevas, des endpoints en service, des tickets sur le tableau, le site publié, et une adresse que vous pouvez envoyer à quelqu'un.", "hue": "build", "tag": "payant" }
  ],
  "caption": "Les deux premiers actes sont gratuits. Ce n'est pas un gadget tarifaire — c'est toute la conception. Les deux actes qui décident si l'acte coûteux vaut la peine ne doivent jamais être la raison pour laquelle quelqu'un les saute."
}
```

Lire une idée ne coûte presque rien. Construire, si. **Choisir quelle preuve vaut la peine d'être menée est la décision la plus lourde de conséquences du premier mois de n'importe quel projet**, et c'est celle pour laquelle la plupart des outils n'ont tout simplement aucune place. Vous décrivez ce que vous voulez ; ils commencent à le construire. Le choix se fait par défaut, et le défaut est toujours l'option la plus chère.

## Pourquoi l'acte du milieu existe

Voici l'échec autour duquel cette méthode est conçue — et ce n'est pas de la négligence. C'est de l'enthousiasme.

```bf-figure
{
  "kind": "compare",
  "title": "Les mêmes six semaines, dépensées de deux façons",
  "columns": [
    {
      "title": "Sans l'acte du milieu",
      "hue": "bad",
      "items": [
        "Décrire l'idée à un outil qui construit des choses.",
        "Six semaines de vraie ingénierie, entièrement compétente.",
        "Lancer. Observer le trafic.",
        "Découvrir que la question de la demande n'a jamais été posée.",
        "Le travail était bon. La question était mauvaise."
      ]
    },
    {
      "title": "Avec lui",
      "hue": "good",
      "items": [
        "Décrire l'idée. Elle est lue et transformée en spécification.",
        "Un après-midi : une landing page, une liste d'attente, un seuil fixé à l'avance.",
        "Deux semaines. Le chiffre arrive sous le seuil.",
        "Arrêter, ou changer l'idée, après avoir dépensé un après-midi.",
        "Six semaines encore disponibles pour la version que les gens voulaient."
      ]
    }
  ],
  "caption": "L'échec coûteux, ce n'est pas de construire lentement la mauvaise chose. C'est de construire la chose qui a l'air juste avant de savoir si quelqu'un la voulait."
}
```

C'est pourquoi le moteur de recommandation de Builderforce est volontairement prudent. Il pondère le **coût** à quarante pour cent du score et ne commence jamais par le système complet, même pour un brief qui cite cinq intégrations et en réclame clairement un. Un moteur de recommandation qui approuverait ce que vous alliez faire de toute façon ne serait pas un conseil. Ce serait un miroir très coûteux.

Chaque option reste toujours proposée. Le classement indique ce qu'il faut mener *en premier* ; masquer une option transformerait une recommandation en verdict, et quelqu'un qui a déjà fait son smoke test doit pouvoir passer au pilote sans avoir à argumenter avec un outil.

## La condition d'arrêt est ce qui en fait une boucle

Une preuve sans condition susceptible d'échouer n'est qu'un lancement avec des étapes en plus.

Chaque formulaire de preuve porte donc des `successCriteria` — énoncés **avant que la chose soit construite**, et non une fois le résultat connu. Un smoke test sans chiffre capable d'arrêter le projet n'est pas un test, c'est une landing page. Un pilote sans critère de sortie ne se termine jamais ; il devient simplement le produit, une extension après l'autre, jusqu'à ce que quelqu'un remarque qu'il est en phase pilote depuis un an.

Ce chiffre, c'est ce que Mesurer évalue. Et c'est ce qui fait de l'arc une boucle plutôt qu'une ligne : la réponse retourne à Idée, et le passage suivant part de quelque chose que vous savez désormais, au lieu de quelque chose que vous espériez.

## Ce que cela donne dans le produit

Rien de ce qui précède n'est le schéma d'une intention. Chaque élément est une surface bien réelle :

- **Lire**, c'est `POST /api/challenges` et le bouton Lire du canevas. Rien n'est écrit dans votre espace de travail et aucun ticket n'est créé. Vous pouvez lire le même brief quatre fois en le modifiant sans rien dépenser.
- **Prouver**, c'est un registre de huit cibles, chacune déclarée comme des données plus une fonction de construction. En ajouter une neuvième, c'est une entrée de registre, pas une nouvelle branche dans un constructeur — c'est la raison structurelle pour laquelle le catalogue peut s'enrichir sans que les conseils se dégradent.
- **Créer** concrétise ce que la cible choisie a renvoyé : fichiers sur le canevas, endpoints en service, tickets créés, site publié, adresse. Les tickets de construction sont ensuite proposés à la porte de la voie autonome : les agents les prennent en charge sur un tableau doté d'effectifs et les déclinent proprement sur un tableau vide.
- **Mesurer**, c'est là qu'arrivent la console de demande, le taux de réussite et le rapport de pilote — chacun jugé au regard du seuil écrit en premier.

## Les limites, en toute honnêteté

Trois choses que cette méthode ne fait pas, dites clairement, parce qu'une méthode qui ne revendique aucune limite n'est qu'un slogan.

Elle ne vous dit pas si votre idée est bonne. Elle vous dit comment le découvrir au moindre coût — un service différent, et plus utile.

Elle ne vous dispense pas de juger *quelle question compte*. Les huit preuves répondent à huit questions différentes — « pouvez-vous me montrer ? », « est-ce que quelqu'un veut ça ? », « est-ce que la partie difficile fonctionne ? » — et choisir la mauvaise question à moindre coût reste choisir la mauvaise question.

Et elle ne rend pas la preuve coûteuse inutile. Parfois, la réponse est vraiment le système complet, à une vraie adresse, avec un runbook d'astreinte. La méthode affirme seulement que vous devriez y arriver après avoir déjà reçu un « oui » de quelque chose qui a coûté un après-midi.

---

*[Ouvrez un canevas](/create/new) et décrivez ce que vous voulez créer — aucun compte nécessaire, le tableau est réel et local jusqu'à ce que vous en décidiez autrement. Une fois connecté, `/realize` lit l'idée et classe les huit preuves en fonction d'elle.*
