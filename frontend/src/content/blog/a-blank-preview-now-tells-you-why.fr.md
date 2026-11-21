# Un aperçu vide vous dit maintenant pourquoi, et une API Laravel démarre dans l'onglet

Vous appuyez sur Run. Le cadre d'aperçu reste blanc. Ou bien il se remplit, mais il lui faut douze secondes, et vous ne savez pas si c'était le réseau, le compilateur, un CDN de paquets ou votre propre code.

Jusqu'ici, le runtime dans le navigateur ne vous donnait presque aucun indice. L'aperçu s'exécute sous une politique de sécurité stricte : une carte qui charge ses tuiles depuis un serveur tiers, ou une police depuis un CDN, est bloquée, et la page a simplement l'air cassée. Un premier chargement lent ressemblait à un chargement rapide resté bloqué. Et si votre API était en Laravel, `php artisan serve` échouait avant d'avoir servi une seule requête.

BuilderForce WebContainers 2026.11.9 comble ces manques. **Un aperçu vide ou lent arrive désormais avec une raison, et une API Laravel démarre maintenant dans l'onglet.**

## Un seul appel qui dit où le temps est passé

`runtime.diagnostics()` renvoie un seul rapport de chargement. Il ne contient que ce que le runtime a mesuré :

- **Les durées des phases** : le démarrage du runtime, le service worker prêt, le chargement du compilateur et le premier rendu de l'aperçu.
- **Le trafic vers le CDN de paquets :** combien de requêtes, leur durée totale et combien ont échoué.
- **Les requêtes par origine** et **les requêtes les plus lentes**, étiquetées par origine et par ce qui les a demandées. Les chemins et les URL sont omis.
- Les **violations récentes de la politique de sécurité** dans l'aperçu.
- Si le cache du navigateur était **froid ou chaud**.
- La liste de ce qui **n'a pas pu être mesuré**, pour qu'un chiffre manquant ne soit pas pris pour un zéro.

```bf-figure
{
  "kind": "flow",
  "title": "Les quatre phases que chronomètre un rapport de chargement",
  "steps": [
    { "label": "Démarrage du runtime", "note": "Le chronomètre part au démarrage du runtime. Toutes les autres phases sont mesurées à partir d'ici.", "hue": "make" },
    { "label": "Service worker prêt", "note": "Le worker qui sert les fichiers de l'aperçu est installé et répond.", "hue": "make" },
    { "label": "Chargement du compilateur", "note": "Le compilateur esbuild en WebAssembly est téléchargé et démarré. Un cache froid se voit d'abord ici.", "hue": "run" },
    { "label": "Premier rendu de l'aperçu", "note": "L'aperçu signale son premier rendu de contenu. C'est le moment où une personne voit quelque chose.", "hue": "measure" }
  ],
  "caption": "Chaque phase porte une heure de début et une durée. Une phase que le navigateur n'a pas pu observer est listée comme indisponible au lieu d'être signalée à zéro."
}
```

Quand quelqu'un dit que l'aperçu est lent, vous voyez donc si le téléchargement du compilateur a pris l'essentiel du temps, ou le CDN de paquets, ou si le cache était simplement froid.

## Voir exactement ce que la politique de sécurité a bloqué

Les aperçus exécutent du code que vous n'avez pas écrit, alors le runtime donne à chacun une Content Security Policy stricte. C'est le bon réglage par défaut, et c'est aussi la raison la plus fréquente pour laquelle un aperçu s'affiche vide ou à moitié stylé.

`runtime.onCspViolation(listener)` indique maintenant à la page hôte quelle origine a été bloquée et sous quelle directive : par exemple, `img-src` a bloqué `https://tile.openstreetmap.org`. Une adresse bloquée est réduite à son origine, si bien qu'aucun chemin ni aucune query ne quitte l'aperçu. Les répétitions sont signalées une fois, et le total est plafonné, pour qu'une page prise dans une boucle ne puisse pas vous submerger.

```bf-figure
{
  "kind": "screen",
  "frame": "Votre page, avec le runtime intégré",
  "ratio": 1.6,
  "regions": [
    { "label": "Aperçu", "note": "Une app de carte sans tuiles : la politique a bloqué le serveur de tuiles", "x": 4, "y": 8, "w": 58, "h": 84, "hue": "muted", "style": "ghost" },
    { "label": "Bloqué : img-src", "note": "https://tile.openstreetmap.org", "x": 66, "y": 8, "w": 30, "h": 24, "hue": "bad" },
    { "label": "Rapport de chargement", "note": "Phases, requêtes CDN, origines les plus lentes, cache froid ou chaud", "x": 66, "y": 36, "w": 30, "h": 34, "hue": "measure" },
    { "label": "Correction", "note": "Ajouter l'origine à la liste des destinations autorisées de l'aperçu", "x": 66, "y": 74, "w": 30, "h": 18, "hue": "good" }
  ],
  "caption": "Le cadre vide cesse d'être un mystère. La violation nomme l'origine et la directive, et la correction tient en une ligne de configuration."
}
```

Vous faites passer une app existante sous la politique ? `previewCspMode: 'report-only'` signale chaque violation sans rien bloquer, pour que vous puissiez d'abord réunir la liste complète. Il désactive la protection : il est donc réservé aux migrations, et votre serveur doit l'autoriser délibérément. Builderforce ne l'active jamais.

## Votre propre CDN de paquets, sans page vide

Si vous servez les paquets npm depuis votre propre miroir au lieu d'esm.sh, le miroir déclare maintenant ses origines et le runtime les ajoute pour vous à la politique de l'aperçu. Un miroir compatible esm.sh demande une seule option :

```ts
const runtime = await startPreviewRuntime({
  relayUrl: 'https://preview.example.com/__bfwc/relay.html',
  cdn: createEsmShCdnFactory({ origin: 'https://esm.example.com' }),
});
```

Un CDN personnalisé qui ne déclarait aucune origine échouait sans bruit : chaque import de paquet était bloqué et l'aperçu restait vide. Désormais, le runtime journalise un avertissement qui nomme le problème, une seule fois.

```bf-figure
{
  "kind": "compare",
  "title": "Un aperçu vide, avant et après",
  "columns": [
    { "title": "Avant 2026.11.9", "hue": "muted", "items": ["Un cadre blanc et aucune raison", "Les origines bloquées visibles seulement sur votre serveur, si vous collectiez les rapports", "Un chargement lent ressemblait à un chargement bloqué", "Un CDN personnalisé sans son origine listée cassait sans bruit", "php artisan serve échouait au démarrage"] },
    { "title": "Avec 2026.11.9", "hue": "run", "items": ["L'origine bloquée et la directive, sur la page hôte", "Un rapport de chargement : phases, CDN, origines, cache", "Le mode report-only pour faire passer une app sous la politique", "Les origines d'un CDN personnalisé rejoignent la politique, ou vous recevez un avertissement", "Une API Laravel démarre avec php artisan serve"] }
  ],
  "caption": "La politique est aussi stricte qu'avant. Ce qui change, c'est qu'elle s'explique."
}
```

## Une API Laravel démarre maintenant dans l'onglet

`php artisan serve` lance le serveur web intégré de PHP comme un processus séparé. La version WebAssembly de PHP qui tourne dans le navigateur ne peut pas lancer de processus de cette façon, donc la commande serve de Laravel échouait avant que l'API ne réponde quoi que ce soit. Le runtime la sert maintenant directement, comme le ferait Laravel, depuis le répertoire `public/` de l'app.

Un frontend Vite, une API Laravel et une base Postgres démarrent donc de bout en bout dans un seul onglet : Composer installe les paquets, les migrations s'exécutent, l'API démarre et le frontend l'atteint par la même adresse.

```bf-figure
{
  "kind": "flow",
  "title": "Une app Vite, Laravel et Postgres qui démarre dans un seul onglet",
  "steps": [
    { "label": "Postgres", "note": "Une vraie base Postgres, hébergée dans la page.", "hue": "measure", "tag": "dans l'onglet" },
    { "label": "composer install", "note": "Installe les paquets de l'API. Sa sortie se termine par sa dernière ligne avant que l'étape suivante ne démarre.", "hue": "make", "tag": "préparation" },
    { "label": "artisan migrate", "note": "Crée le schéma une fois les paquets et la base prêts.", "hue": "make", "tag": "préparation" },
    { "label": "artisan serve", "note": "L'API Laravel, prête quand sa route de santé répond.", "hue": "run", "tag": "dans l'onglet" },
    { "label": "Frontend Vite", "note": "La page que vous parcourez, qui appelle l'API sous /api.", "hue": "run", "tag": "dans l'onglet" }
  ],
  "caption": "Les étapes de préparation sont aussi des services : chacune se termine avant que les services qui en dépendent ne démarrent, et son journal complet est alors disponible."
}
```

Les étapes de préparation ont reçu une correction de plus. Quand `composer install` ou `npm install` se termine, son journal se termine désormais toujours par sa dernière ligne avant que le service suivant ne change d'état. Si une étape échoue, l'erreur dont vous avez besoin est dans le journal, et non coupée juste au-dessus.

## De petites choses qui facilitent l'hébergement

- **Le bundle du runtime .NET s'installe depuis npm** sous le nom `@seanhogg/builderforce-webcontainers-dotnet`, à la même version que le runtime. Copiez-le dans vos fichiers statiques et pointez le runtime dessus.
- **Un tableau de tous les assets chargés à l'exécution.** Le README liste maintenant chaque origine d'où le runtime télécharge, quelle page ou quel worker la contacte, quand, et comment l'héberger vous-même. Si votre site a une politique stricte ou pas de réseau, vous voyez exactement quoi répliquer.

## Où cela se place dans la méthode

Idea to Real est un arc, **Idea → Make → Run → Measure**, avec une boucle à l'intérieur : [Read, Prove, Build](/blog/read-prove-build-the-inner-loop). Lire et prouver ne coûtent rien, si bien que la décision de construire est une vraie décision.

Une preuve n'aide que si sa réponse est claire. Lancez un smoke test ou une preuve de concept et obtenez une page vide, et vous ne pouvez pas dire si c'est l'idée qui a échoué ou la plomberie. Un rapport de chargement et une origine bloquée nommée séparent les deux : soit l'app fait ce que vous avez décrit, soit vous savez quelle ligne de configuration l'en a empêchée.

```bf-figure
{
  "kind": "stack",
  "title": "L'arc, avec Run et Measure qui rendent compte",
  "bands": [
    { "label": "Idea", "note": "Lisez-la, et choisissez la preuve la moins chère qui vaille d'être lancée : un smoke test, une preuve de concept, un pilote.", "hue": "idea" },
    { "label": "Make", "note": "Construisez la seule chose que la preuve demandait, API Laravel comprise.", "hue": "make" },
    { "label": "Run", "note": "Voyez-la démarrer dans l'onglet. Si l'aperçu est vide, l'origine bloquée est nommée.", "hue": "run", "tag": "s'explique" },
    { "label": "Measure", "note": "Durées des phases et nombre de requêtes, pour qu'une exécution lente porte un chiffre.", "hue": "measure", "tag": "rapport de chargement" }
  ],
  "caption": "Une preuve qui échoue devrait être un enseignement sur l'idée, pas sur l'aperçu."
}
```

## Ce que vous pouvez faire dès aujourd'hui

- **Découvrir pourquoi un aperçu est vide** en lisant l'origine bloquée et la directive, puis autoriser cette origine.
- **Découvrir pourquoi un aperçu est lent** avec un seul appel qui chronomètre chaque phase et compte le trafic vers le CDN et les origines.
- **Faire passer une app existante sous la politique** avec le mode report-only, puis revenir à l'application stricte.
- **Servir les paquets depuis votre propre miroir** sans lister son origine à la main.
- **Faire tourner une API Laravel** avec un frontend Vite et Postgres, de bout en bout, dans l'onglet du navigateur.
- **Héberger le runtime sur un site verrouillé**, avec la liste de tout ce qu'il charge et le bundle .NET depuis npm.

---

**À lire aussi :** [BuilderForce WebContainers est open source](/blog/builderforce-webcontainers-open-source) · [Votre app full-stack s'exécute maintenant dans l'onglet de navigateur où vous l'avez créée](/blog/your-full-stack-app-now-runs-in-your-browser-tab) · [Read, Prove, Build : la boucle interne](/blog/read-prove-build-the-inner-loop)

[Lisez le runtime sur GitHub](https://github.com/SeanHogg/builderforce-webcontainers), ou [ouvrez un canvas](/create), décrivez une app avec une API Laravel et appuyez sur Run.
