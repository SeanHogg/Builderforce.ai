Vous payez Kimi. Kimi K3 est un excellent modèle de code, avec une fenêtre de contexte d'un million de tokens. Vous voulez l'utiliser sur le travail en cours : pour planifier une modification, l'écrire, ou les deux.

Jusqu'ici, cela demandait plus de configuration que nécessaire. L'edge de Kimi refuse le trafic des plateformes cloud hébergées avant même de lire un identifiant. Un abonnement Kimi connecté à votre espace de travail ne fonctionnait donc que tant qu'un runtime Builderforce séparé était en ligne pour relayer les requêtes. Dans l'éditeur, Kimi n'apparaissait que si vous aviez aussi installé la CLI Kimi Code et que vous vous y étiez connecté. Dans Rovr, il n'apparaissait pas du tout.

## Choisissez Kimi, la connexion vient à vous

L'ordre est désormais celui que l'on attend. Vous choisissez d'abord le modèle, et Builderforce ne demande le compte que s'il n'en a pas encore.

```bf-figure
{
  "kind": "flow",
  "title": "Le premier tour avec Kimi, du début à la fin",
  "steps": [
    { "label": "Choisir", "note": "Choisissez Kimi K3 dans le sélecteur de modèles de VS Code ou dans Réglages → Modèle de Rovr.", "hue": "idea" },
    { "label": "Se connecter", "note": "Pas encore de compte Kimi dans l'espace de travail ? La page de connexion de Kimi s'ouvre avec le code déjà renseigné. Approuvez, c'est fini : rien à coller.", "hue": "make" },
    { "label": "Conserver", "note": "La connexion est enregistrée dans les intégrations de votre espace de travail : l'application web, l'éditeur et Rovr voient le même compte.", "hue": "make" },
    { "label": "Exécuter", "note": "Votre machine détient un jeton de courte durée et appelle Kimi directement. L'éditeur et le navigateur sont précisément le client personnel pour lequel l'abonnement est concédé.", "hue": "make", "tag": "sur votre machine" }
  ],
  "caption": "Le compte appartient à l'espace de travail, le jeton vit sur la machine. Builderforce est le seul à renouveler la connexion, si bien qu'un second ordinateur ne se retrouve jamais avec une connexion déjà révoquée."
}
```

Deux détails font que cela tient au quotidien.

**Le jeton est volontairement de courte durée.** Votre machine ne stocke qu'un jeton d'accès de quinze minutes, jamais l'identifiant de renouvellement à longue durée de vie. Kimi remplace cet identifiant à chaque utilisation : si deux endroits le renouvellent, l'un des deux détient toujours un identifiant mort. Builderforce le renouvelle, et chaque appareil lui demande un jeton neuf quand il en a besoin. L'éditeur et Rovr réutilisent un jeton enregistré d'un redémarrage à l'autre tant qu'il est valide, si bien que la plupart des tours ne font aucune requête supplémentaire.

**K3, c'est vous qui décidez.** Kimi K3 est inclus dans certaines offres Kimi et pas dans d'autres. Builderforce n'envoie donc pas discrètement chaque tour Kimi vers un modèle que votre offre pourrait refuser. Si votre offre inclut K3, ouvrez Réglages → Vos propres modèles → Kimi et placez K3 en tête. L'éditeur, Rovr et les exécutions cloud commenceront alors par lui, puis descendront votre liste si nécessaire.

```bf-figure
{
  "kind": "compare",
  "title": "Utiliser votre abonnement Kimi",
  "columns": [
    { "title": "Avant", "hue": "muted", "items": ["Connecter Kimi sur le web", "Installer et lancer un runtime d'agent séparé pour qu'il relaie", "Ou installer la CLI Kimi Code et s'y connecter pour l'éditeur", "Rien dans Rovr"] },
    { "title": "Maintenant", "hue": "make", "items": ["Choisir Kimi K3 là où vous travaillez", "Approuver une connexion quand le premier tour la demande", "L'éditeur et Rovr appellent Kimi eux-mêmes", "Une seule connexion, partagée par tout l'espace de travail"] }
  ],
  "caption": "Si la CLI Kimi Code est déjà connectée sur votre machine, l'éditeur utilise toujours cette connexion en premier. La connexion de l'espace de travail permet à tout le reste de fonctionner sans elle."
}
```

## Où cela se situe dans la méthode

La plupart du temps, il s'agit de l'acte **Construire**. Construire est l'étape coûteuse de [Lire, Prouver, Construire](/blog/read-prove-build-the-inner-loop), et c'est là que la puissance de code du modèle décide du nombre de passes nécessaires à une modification. Builderforce attribue déjà un rôle à chaque tour : une exécution planifie d'abord, puis confie la première modification de code au meilleur modèle de code que vous avez connecté. Kimi K3 peut désormais tenir l'un ou l'autre rôle, ou les deux : planifier avec un modèle bon marché et coder avec K3, planifier avec K3 et passer la main à Claude, ou tout garder sur K3.

Cela compte aussi pour **Lire et Prouver**. Ces deux étapes ne coûtent rien pour que la décision de construire soit une vraie décision, et une fenêtre d'un million de tokens permet de lire un dépôt entier en une seule passe avant de s'engager sur une modification.

## Ce que vous pouvez en faire dès aujourd'hui

- **Choisir Kimi K3 dans VS Code** sans rien installer d'autre. Le sélecteur propose « Connecter Kimi » puis, une fois connecté, vous laisse choisir le modèle Kimi des nouveaux tours.
- **Utiliser Kimi dans Rovr**, l'assistant du navigateur. Réglages → Modèle liste vos modèles Kimi. Si un tour Kimi ne trouve aucun compte, le chat affiche une carte de connexion plutôt qu'une erreur.
- **Connecter une seule fois pour tout l'espace de travail.** Un compte connecté depuis l'éditeur apparaît sur le web et dans Rovr, et inversement.
- **Placer K3 en tête** si votre offre l'inclut : toutes les surfaces commenceront par lui.

---

**À lire aussi :** [Lire, Prouver, Construire : la boucle interne](/blog/read-prove-build-the-inner-loop)

Ouvrez le sélecteur de modèles dans VS Code, choisissez **Connecter Kimi** et essayez votre prochaine modification avec K3.
