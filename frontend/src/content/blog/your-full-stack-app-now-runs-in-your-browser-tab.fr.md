# Votre app full-stack s'exécute maintenant dans l'onglet de navigateur où vous l'avez créée

Vous décrivez une app : une page, une API derrière, une base de données dessous. Les fichiers sont bons. Le blueprint est bon. Puis vous attendez — qu'un conteneur soit planifié, démarré, installé et câblé — avant de savoir si tout cela fonctionne ensemble.

Cette attente n'est pas un détail. C'est l'écart entre *j'ai fabriqué quelque chose* et *je sais que ça marche*, et chaque minute de cet écart est une minute où l'idée aurait pu être testée au lieu d'être mise en file d'attente.

Cet écart a disparu. **Run démarre désormais toute votre app dans l'onglet du navigateur.**

## Ce qui démarre quand vous appuyez sur Run

Le blueprint d'app de votre projet liste ses services. Les services Node, Python et PHP — Express ou Next.js, FastAPI, Flask, Django, Laravel, Slim — tournent dans l'onglet, et la base de données est un vrai Postgres qui tourne dans la page. Ils sont reliés entre eux, et l'aperçu en direct s'ouvre à côté du board.

```bf-figure
{
  "kind": "flow",
  "title": "Une app full-stack, entièrement dans un onglet",
  "steps": [
    { "label": "Frontend", "note": "Votre page démarre dans son propre environnement et sert l'aperçu en direct dans lequel vous cliquez.", "hue": "make", "tag": "dans l'onglet" },
    { "label": "API", "note": "Un service Node, Python ou PHP répond aux requêtes de la page via une connexion virtuelle avec le frontend.", "hue": "run", "tag": "dans l'onglet" },
    { "label": "Postgres", "note": "Une vraie base Postgres, hébergée dans la page, de sorte que requêtes, schéma et données d'amorçage se comportent comme en production.", "hue": "measure", "tag": "dans l'onglet" }
  ],
  "caption": "Trois services, deux connexions, un onglet de navigateur. Le code, les données et les requêtes de l'app restent dans votre onglet ; seuls les paquets sont téléchargés, depuis leurs registres."
}
```

Il n'y a aucun conteneur à démarrer ni à provisionner, et l'exécution n'utilise aucune ressource de calcul dans le cloud. Les installations ont toujours lieu — npm, pip et composer s'exécutent dans l'onglet avant la première page — et le premier Run démarre l'environnement d'exécution dans l'onglet.

## Exécution en conteneur contre exécution dans le navigateur

```bf-figure
{
  "kind": "compare",
  "title": "Deux façons de voir la même app tourner",
  "columns": [
    { "title": "Exécuter dans un conteneur", "hue": "muted", "items": ["Attendre qu'une machine soit planifiée", "Attendre le démarrage et l'installation", "Une nouvelle machine avant chaque premier coup d'œil", "Consomme du calcul cloud à chaque coup d'œil", "Adapté aux exécutions et aux déploiements"] },
    { "title": "Exécuter dans le navigateur", "hue": "run", "items": ["Aucun conteneur à démarrer ni à provisionner", "Frontend, API et base de données dans un onglet", "Les installations (npm, pip, composer) s'exécutent dans l'onglet", "Ne coûte aucun calcul cloud", "Adapté pour savoir si ça marche"] }
  ],
  "caption": "Le conteneur est toujours là, et reste l'endroit des exécutions et des déploiements. Il a simplement cessé d'être le prix d'un premier coup d'œil."
}
```

## Le Brain travaille de la même façon dans les deux cas

Exécuter ailleurs ne servirait à rien si l'assistant ne pouvait pas voir à l'intérieur. Il le peut. Les mêmes outils d'exécution — lire les logs, redémarrer un service, capturer l'aperçu — fonctionnent que l'app tourne dans votre onglet ou dans un conteneur. Demandez au Brain pourquoi la page de paiement renvoie une erreur : il lit les logs de l'API, modifie le gestionnaire, redémarre le service et capture de nouveau la page. Il n'a pas besoin de savoir où vit l'app.

C'est important, car une exécution rapide n'est que la moitié d'une boucle rapide. L'autre moitié est un assistant capable d'observer le résultat et d'agir dessus.

## Où cela se place dans la méthode

Idea to Real est un arc — **Idea → Make → Run → Measure** — et une boucle à l'intérieur : [Read, Prove, Build](/blog/read-prove-build-the-inner-loop). Lire et prouver ne coûtent rien, si bien que la décision de construire est bien une décision. Construire, c'est là que les coûts commencent.

Run est l'étape où ce que vous avez fabriqué doit survivre au contact avec lui-même : la page atteint-elle l'API, l'API atteint-elle les données, le chemin entier fait-il ce que vous avez décrit ? Une preuve dans la méthode vaut ce que vaut la rapidité de sa réponse. Un smoke test, une preuve de concept, un pilote : chacun est une question, et mieux vaut la poser tant que l'idée est encore chaude.

```bf-figure
{
  "kind": "stack",
  "title": "L'arc, avec l'étape Run dans l'onglet",
  "bands": [
    { "label": "Idea", "note": "Et si ? Lisez-la et choisissez la preuve la moins chère qui vaille d'être payée.", "hue": "idea" },
    { "label": "Make", "note": "Construisez la seule chose que la preuve demandait — blueprint, services, données.", "hue": "make" },
    { "label": "Run", "note": "Voyez-la fonctionner de bout en bout, là où vous l'avez créée, sans attendre de conteneur.", "hue": "run", "tag": "désormais dans l'onglet" },
    { "label": "Measure", "note": "Évaluez-la face à la condition d'arrêt et renvoyez le résultat à Idea.", "hue": "measure" }
  ],
  "caption": "Exécuter était un endroit où l'on se rendait. C'est maintenant un état du board sur lequel vous êtes déjà."
}
```

## Ce que vous pouvez faire dès aujourd'hui

- **Appuyer sur Run et voir votre app full-stack fonctionner dans l'onglet** — frontend, API et base de données ensemble, sans conteneur à démarrer ni à provisionner.
- **Prouver une idée tant qu'elle est encore chaude.** L'exécution démarre dans l'onglet où vous êtes déjà : aucune file d'attente entre la question et la réponse.
- **Essayer des changements librement.** Une exécution ne coûte aucun calcul cloud : redémarrer dix fois pour traquer un bug ne coûte pas plus qu'une fois.
- **Confier la boucle au Brain.** Il lit les logs, redémarre les services et capture l'aperçu exactement comme pour un conteneur.
- **Garder les conteneurs pour ce qu'ils font bien** — exécutions et déploiements — quand l'app est prête à quitter l'onglet.

---

**À lire aussi :** [L'app de votre canvas est maintenant un vrai projet](/blog/your-canvas-app-is-a-real-project) · [Exécutez l'app que votre board vient de construire](/blog/run-your-app-on-the-canvas) · [Read, Prove, Build : la boucle interne](/blog/read-prove-build-the-inner-loop)

[Ouvrez un canvas](/create), décrivez une app avec une base de données et appuyez sur Run.
