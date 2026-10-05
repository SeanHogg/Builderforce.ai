Un ado de treize ans avec une idée de jeu Roblox a deux problèmes, et un seul s'appelle Luau.

Le premier, c'est le langage. Les jeux Roblox sont des scripts Lua qui dialoguent de part et d'autre de la frontière client–serveur, et le chemin entre « je veux un obby où les plateformes disparaissent » et des `RemoteEvent` qui fonctionnent est long. Les outils d'IA pour Roblox existent pour le raccourcir, et ils y parviennent en général.

Le second problème, c'est tout ce qui entoure l'IA. Les outils actuels demandent à un jeune créateur de télécharger une app, d'installer un plugin Studio, de lancer un serveur local, de brancher un outil de synchronisation et de garder les quatre en marche : trente minutes à une heure avant la première demande. Ensuite, ils facturent chaque tentative, y compris celles qui échouent, et ils injectent ce que le modèle a écrit directement dans un jeu auquel d'autres enfants joueront.

**Spawn** règle le second problème, et du coup le premier aussi.

## Une seule chose à installer, puis il suffit de parler

```bf-figure
{
  "kind": "flow",
  "title": "De l'installation au jeu jouable",
  "steps": [
    { "label": "Installer Spawn", "note": "Connexion une seule fois dans le navigateur. Spawn écrit lui-même son plugin Roblox Studio. Pas de visite au Creator Store, pas de serveur à lancer.", "hue": "idea" },
    { "label": "Dire quoi construire", "note": "Spawn lit l'emplacement ouvert (l'Explorateur et les scripts) pour que le nouveau s'accorde avec l'existant.", "hue": "make" },
    { "label": "Appuyer sur Play", "note": "Les erreurs du test remontent à Spawn, et un clic lui demande de les corriger.", "hue": "run", "tag": "dans Studio" }
  ],
  "caption": "L'app est le pont. On installe une seule chose, on ouvre Studio et on commence à écrire."
}
```

L'app Spawn tourne à côté de Roblox Studio. Au démarrage, elle écrit le plugin Spawn dans le dossier des plugins de Studio avec une clé privée qu'elle seule connaît. Quand Studio s'ouvre, le plugin trouve l'app sur le même ordinateur et se connecte. Pas de projet Rojo à configurer, pas de port à ouvrir, rien d'accessible depuis l'extérieur de la machine.

```bf-figure
{
  "kind": "screen",
  "frame": "Spawn à côté de Roblox Studio",
  "ratio": 1.62,
  "regions": [
    { "label": "La conversation", "note": "Dis-le avec tes mots ; idées de départ : obby, tycoon, simulateur, course, tower defense", "x": 4, "y": 10, "w": 40, "h": 70, "hue": "idea" },
    { "label": "Connexion Studio et jetons", "x": 4, "y": 2, "w": 40, "h": 6, "hue": "accent" },
    { "label": "Roblox Studio", "note": "La création arrive en vraies pièces et vrais scripts, une étape d'annulation par création", "x": 48, "y": 2, "w": 48, "h": 78, "hue": "make" },
    { "label": "Corrige les erreurs de mon test", "x": 4, "y": 84, "w": 92, "h": 10, "hue": "run" }
  ],
  "caption": "Chaque création se voit dans la vue 3D et se lit dans l'Explorateur, puis se garde ou s'annule."
}
```

## Ce qu'est vraiment une création

Spawn ne tape jamais dans Studio. Chaque création revient sous forme d'une courte liste d'opérations : *crée ce script*, *place cette pièce ici avec ces propriétés*, *supprime ça*. Le plugin applique toute la liste dans une seule étape d'annulation de Studio. Si une création ne te plaît pas, Ctrl+Z la retire entièrement d'un coup.

Avant d'atteindre ton jeu, chaque opération passe un filtre de sécurité, strict sur ce qui compte le plus dans les jeux que les enfants font pour d'autres enfants :

- **Pas de portes dérobées.** Les scripts qui appellent Internet (`HttpService`), exécutent du code caché (`loadstring`, `getfenv`) ou chargent du code par id de ressource (`require(12345)`) sont refusés. Ce sont exactement les astuces des « modèles gratuits » pour prendre le contrôle de jeux Roblox.
- **Rien que tu ne puisses voir.** Spawn construit avec des pièces, couleurs, matériaux, lumières, particules et interfaces. Il n'importe jamais par id une image, un son ou un maillage que tu n'as pas vu.
- **Adapté aux 13 ans et plus.** Le constructeur suit les Règles de la communauté Roblox. Si tu demandes quelque chose qui dépasse les limites, Spawn te le dit gentiment et propose une version qui convient. Cette réponse ne coûte rien.

## Tu ne paies que les créations qui marchent

```bf-figure
{
  "kind": "compare",
  "title": "Où va l'argent",
  "columns": [
    { "title": "Outil d'IA Roblox classique", "hue": "muted", "items": ["Longue installation avant la première demande", "Chaque tentative facturée, même ratée", "Ce qu'écrit le modèle va droit dans le jeu", "Aucune limite d'âge"] },
    { "title": "Spawn", "hue": "make", "items": ["Installe lui-même son plugin Studio", "Les créations ratées ou refusées sont gratuites", "Chaque opération passe un filtre de sécurité", "13 ans et + avec une seule vérification d'âge"] }
  ],
  "caption": "Une création coûte les jetons qu'elle a vraiment utilisés, et seulement si elle a modifié ton jeu."
}
```

Chaque nouveau joueur a droit à **une semaine gratuite** : sept jours et 50 000 jetons, environ quatre créations, sans carte. Le joueur ajoute l'e-mail d'un adulte, qui reçoit un lien pour continuer Spawn sans le mot de passe du joueur. Après cette semaine, l'abonnement Spawn coûte **1,99 $ par mois**. La construction fonctionne avec des jetons, achetés en packs de **10, 20, 50 ou 100 $**, et les gros packs offrent des jetons bonus. Une création typique utilise environ douze mille jetons : un pack de 10 $ représente donc environ quatre-vingts créations. Le solde est toujours visible dans l'app. Quand une création échoue, est illisible ou voit toutes ses modifications refusées, le solde n'est pas touché.

Les achats se font sur le site via le paiement Stripe, jamais dans l'app. C'est voulu : la personne qui paie, souvent un parent, choisit chaque recharge.

## Sa place dans la méthode

Chaque produit Builderforce suit le même arc : **Idée → Faire → Exécuter → Mesurer**, avec [Lire, Prouver, Construire](/blog/read-prove-build-the-inner-loop) comme boucle intérieure. Spawn, c'est cet arc à la taille d'un premier jeu.

**Faire**, c'est la création : une phrase en entrée, des pièces et des scripts en sortie, dans l'emplacement déjà ouvert. **Exécuter**, c'est le bouton Play de Studio, l'étape où la plupart des outils d'IA te laissent seul. Spawn écoute la sortie du test, si bien qu'un script qui plante à la ligne 40 devient un bouton « Les corriger » plutôt qu'un mystère. **Mesurer**, c'est ce qu'un jeune créateur fait le mieux : jouer, remarquer ce qui est ennuyeux et demander la suite. La boucle entre *une idée* et *un truc sur lequel sauter* dure une minute, et chaque tour apprend ce que fait le Luau, parce que les scripts sont propres et bien nommés pour être lus.

## Commencer

1. Va sur [spawn.builderforce.ai](/spawn) et crée ton compte (demande à un parent).
2. Commence ta semaine gratuite (demande l'e-mail d'un adulte). Ensuite, abonne-toi pour 1,99 $ par mois et prends un pack de jetons.
3. Télécharge l'app Spawn, connecte-toi, ouvre Roblox Studio et écris ce que tu veux construire.

*Spawn est créé par Builderforce.ai et n'est pas affilié à Roblox Corporation ni approuvé par elle.*
