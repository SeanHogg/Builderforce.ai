# Votre app vous répond désormais — sa console, ses connexions en direct et une copie à emporter

Une app qui s'exécute sous vos yeux mais ne peut pas vous dire ce qu'elle fait n'est qu'une capture d'écran qui bouge.

C'était plus proche de la réalité que nous ne l'aurions voulu. Une app Builderforce tournait dans votre navigateur, mais dès qu'elle faisait quelque chose d'intéressant — journaliser un avertissement, ouvrir une connexion en direct, poser un cookie de connexion — l'aperçu se taisait. Le Brain voyait les plantages, et rien d'autre. Une app de chat construite avec WebSockets ne se connectait à rien. Une connexion fonctionnait une fois, puis vous oubliait au clic suivant. Et à chaque retour, le projet recommençait par un `npm install` complet, comme s'il ne vous avait jamais vu.

Cette version comble ces lacunes. Elles se situent toutes au même endroit : la boucle entre le moment où vous faites une modification et celui où vous voyez ce qu'elle a produit.

## Ce que l'app vous dit désormais

```bf-figure
{
  "kind": "screen",
  "frame": "L'espace de travail Studio, onglet Console ouvert",
  "ratio": 1.62,
  "regions": [
    { "label": "Votre app en cours d'exécution", "note": "L'aperçu, à la largeur que vous avez choisie", "x": 4, "y": 6, "w": 58, "h": 56, "hue": "make" },
    { "label": "Brain", "note": "Lit la même console que vous", "x": 66, "y": 6, "w": 30, "h": 56, "hue": "idea" },
    { "label": "Console", "note": "Chaque log, avertissement et erreur écrits par l'app, filtrés par niveau, répétitions comptées", "x": 4, "y": 66, "w": 92, "h": 28, "hue": "run", "tag": "nouveau" }
  ],
  "caption": "L'onglet Console se trouve à côté de Terminal, Sortie et Problèmes. Ce que l'app écrit s'y affiche pendant qu'elle tourne, depuis chaque page qu'elle sert."
}
```

- **Un onglet Console.** Tout ce que votre app écrit avec `console.log`, `warn` ou `error` s'affiche à côté du terminal, au moment où cela se produit. Vous pouvez filtrer par niveau, les lignes répétées sont comptées au lieu de s'empiler, et chaque exécution démarre avec une console vierge.
- **Le Brain la lit aussi.** Demandez « pourquoi le panier est-il vide ? » et le Brain peut regarder ce que l'app a réellement journalisé, pas seulement si elle a planté. Après un correctif, il peut relire la console pour vérifier que l'avertissement a disparu.
- **Chaque page, pas seulement la première.** Les erreurs et les logs proviennent des pages du serveur de développement, mais aussi des pages renvoyées par un serveur Node. Une app Express avec cinq routes remonte des informations depuis les cinq.

## Des apps qui restent connectées

Une bonne partie de ce que l'on construit fonctionne en direct : chats, tableaux de bord qui se mettent à jour, tableaux multijoueurs, barres de progression pour les tâches longues. Tout cela repose sur trois choses qu'un aperçu dans le navigateur ne sait généralement pas faire — et désormais, les trois fonctionnent.

```bf-figure
{
  "kind": "compare",
  "title": "Dans l'aperçu",
  "columns": [
    { "title": "Avant", "hue": "muted", "items": ["Les réponses arrivaient d'un bloc, une fois le serveur terminé", "Les WebSockets n'avaient nulle part où se connecter", "Un cookie de connexion disparaissait à la requête suivante", "Les scripts shell avec if, for ou while échouaient"] },
    { "title": "Maintenant", "hue": "run", "items": ["Les Server-Sent Events et la progression arrivent au fil de l'écriture", "Les WebSockets se connectent au serveur de l'app et en rapportent les envois", "Les connexions tiennent : les cookies posés par le serveur reviennent à chaque requête", "Les scripts shell avec if, for, while, case et des fonctions s'exécutent tels qu'écrits"] }
  ],
  "caption": "Tout cela s'exécute dans l'onglet de votre navigateur, sans serveur de notre part au milieu et sans en-têtes particuliers sur votre site."
}
```

Il en va de même pour les commandes du README d'un projet. `pnpm install`, `yarn dev` et `pnpm dlx` fonctionnent tels qu'écrits, aux côtés de npm.

## Reprenez là où vous vous étiez arrêté

```bf-figure
{
  "kind": "flow",
  "title": "Votre deuxième visite",
  "steps": [
    { "label": "Ouvrir le projet", "note": "Le même package.json que la dernière fois", "hue": "make" },
    { "label": "Restaurer", "note": "Les paquets installés lors de votre dernière visite reviennent depuis le stockage de ce navigateur", "hue": "run", "tag": "des secondes, pas des minutes" },
    { "label": "Exécuter", "note": "Le serveur de développement démarre aussitôt. Un package.json modifié s'installe comme d'habitude", "hue": "run" }
  ],
  "caption": "Les paquets installés sont conservés sur votre appareil, pour vos projets les plus récents. Modifiez une dépendance : l'exécution suivante réinstalle, puis conserve cette version."
}
```

La première exécution d'un projet installe ses paquets comme toujours. Ensuite, ils sont conservés dans votre navigateur. À votre visite suivante, ils sont restaurés et le projet passe directement à l'exécution ; les installations faites par le Brain utilisent le même stockage.

## Emportez-la avec vous

**Télécharger le projet** se trouve dans le menu Plus du Studio et dans la barre de panneaux de l'app du canvas. Vous obtenez un zip du code source de votre app, sans `node_modules` ni sortie de build, prêt à ouvrir dans n'importe quel éditeur, à pousser vers n'importe quel hébergeur ou à confier à qui vous voulez. Ce que vous construisez sur Builderforce vous a toujours appartenu. Désormais, c'est aussi à un clic.

## Sa place dans la méthode

Construire est le troisième acte de [Lire, Prouver, Construire](/blog/read-prove-build-the-inner-loop), et le plus coûteux. Une fois que vous y êtes, toute l'expérience tient à la brièveté du trajet entre *modifier quelque chose* et *savoir ce que cela a produit*.

Chacune des lacunes ci-dessus était un endroit où ce trajet se rompait. Soit l'app faisait quelque chose que vous ne pouviez pas voir, soit elle ne pouvait pas faire ce que ferait la vraie app, soit revenir vous coûtait les premières minutes. Les combler garde l'acte Construire honnête : ce que vous voyez dans l'aperçu, c'est ce que fera l'app. Ensuite, le bouton de téléchargement fait passer votre travail de Fabriquer à Exploiter, sur l'infrastructure de votre choix.

## Ce que vous pouvez faire dès aujourd'hui

- **Ouvrez l'onglet Console** pendant que votre app tourne, ou demandez au Brain ce que l'app journalise.
- **Construisez quelque chose en direct :** un chat, un tableau de bord qui se met à jour, un téléversement avec barre de progression. Puis utilisez-le dans l'aperçu.
- **Connectez-vous à votre propre app** et restez connecté.
- **Revenez demain** et évitez la réinstallation.
- **Téléchargez le projet** et emportez-le où vous voulez.

---

**À lire aussi :** [Exécutez l’app que votre tableau vient de construire](/blog/run-your-app-on-the-canvas) · [BuilderForce WebContainers est open source](/blog/builderforce-webcontainers-open-source)

[Ouvrez un canvas](/create) et construisez quelque chose qui doit rester connecté.
