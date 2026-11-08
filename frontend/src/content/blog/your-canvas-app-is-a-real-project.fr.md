# L’application sur votre canevas est désormais un vrai projet

Vous esquissez une idée sur le canevas, vous demandez à Brain un site marketing et vous appuyez sur **App**.

Jusqu’à aujourd’hui, ce que vous y voyiez était un aperçu. Le canevas prenait les cartes de code du tableau, assemblait la page et ses feuilles de style en un seul document et l’affichait dans un cadre. C’était utile pour regarder des choses. Il ne pouvait pas exécuter la partie serveur de quoi que ce soit, ne pouvait pas installer un paquet et n’avait pas de base de données. Dès que l’idée en avait besoin, vous quittiez le canevas pour Studio et recommenciez dans une seconde fenêtre, avec une seconde conversation.

Désormais, l’onglet App **est** Studio. C’est le même espace de travail, à l’intérieur du canevas où vous étiez déjà.

## Ce qu’ouvre App désormais

```bf-figure
{
  "kind": "screen",
  "frame": "Un canevas, lu comme son application",
  "ratio": 1.62,
  "regions": [
    { "label": "L’application en marche", "note": "De vrais fichiers sur un vrai serveur de développement, avec rechargement à chaud", "x": 4, "y": 10, "w": 46, "h": 56, "hue": "make" },
    { "label": "Fichiers", "note": "À ouvrir depuis la barre, recherche dans tout le projet", "x": 51, "y": 10, "w": 16, "h": 56, "hue": "accent" },
    { "label": "Terminal · Sortie · Problèmes", "x": 4, "y": 68, "w": 63, "h": 14, "hue": "run" },
    { "label": "Brain", "note": "Le Brain propre au canevas, désormais capable de modifier les fichiers de l’application", "x": 70, "y": 10, "w": 26, "h": 72, "hue": "idea" },
    { "label": "Exécuter · Aperçu · Code · Base de données · Publier", "x": 4, "y": 88, "w": 92, "h": 8, "hue": "accent" }
  ],
  "caption": "Le canevas conserve sa propre interface : une barre de session, un Brain, un arc d’étapes. L’espace de travail ajoute ses commandes à la barre plutôt que de dessiner une seconde barre d’outils."
}
```

- **Un vrai projet derrière.** Il contient les fichiers que l’agent a écrits, un environnement d’exécution dans le navigateur qui installe des paquets et exécute un serveur de développement (et un serveur Node, si votre application en a un), plus un terminal, des vérifications et une liste de problèmes.
- **Un seul Brain.** Le panneau Brain à droite est le Brain du canevas, celui auquel vous parliez déjà. Il peut désormais lister, lire, rechercher et modifier les fichiers de l’application : « rends l’en-tête fixe » change donc le code et l’aperçu se met à jour.
- **Vos cartes de code deviennent des fichiers.** Si vous construisiez avec des cartes de code sur le tableau, App les amène dans le projet à sa première ouverture, puis à chaque modification d’une carte. Rien n’est demandé et rien n’est perdu.
- **Base de données et Publier quand vous en avez besoin.** La même vue Base de données et le même panneau Publier que ceux de Studio, à un clic de la barre de session.
- **Ouvrir dans Studio** quand vous voulez tout l’écran. C’est le même projet : rien n’est à copier.

## Commencez sans compte

```bf-figure
{
  "kind": "flow",
  "title": "D’un canevas invité à une application durable",
  "steps": [
    { "label": "Appuyer sur App", "note": "Choisissez Site web, Mobile ou Web + Mobile — ou demandez simplement à Brain", "hue": "idea" },
    { "label": "Elle s’exécute ici", "note": "Le projet vit dans votre navigateur et s’exécute sur le même environnement d’exécution que Studio", "hue": "make", "tag": "sans compte" },
    { "label": "Conserver votre travail", "note": "Votre tableau est enregistré dans un compte et les fichiers de l’application l’accompagnent dans un vrai projet", "hue": "run" },
    { "label": "Publier", "note": "L’historique, une base de données et une adresse en ligne s’activent", "hue": "accent" }
  ],
  "caption": "Rien n’est reconstruit lors du passage de relais. Les fichiers que vous aviez dans le navigateur sont les fichiers avec lesquels le projet démarre."
}
```

Vous n’avez pas besoin de vous inscrire pour savoir si l’idée fonctionne. Un canevas sans compte exécute son application à partir de fichiers conservés dans votre navigateur, sur le même environnement d’exécution que celui de Studio. Quand cela vaut la peine d’être conservé, appuyez sur **Conserver votre travail**. Le tableau passe dans votre compte, et l’application l’accompagne dans un projet durable, avec historique des versions, base de données et publication.

## Plus d’une application sur un tableau

Un tableau peut contenir plusieurs versions : un site marketing et un outil d’administration, ou une application web et son jumeau mobile. App en exécute une à la fois, et un sélecteur apparaît dans la barre de session dès qu’il y en a une deuxième. Ouvrir n’importe quelle carte de version sur le tableau vous y amène directement.

## Sa place dans la méthode

Réaliser est l’acte où une idée devient quelque chose que l’on peut utiliser. C’était aussi l’acte qui se scindait en deux produits. Lire et [Prouver](/blog/read-prove-build-the-inner-loop) se déroulaient sur le canevas, et la vraie construction dans un IDE distinct. La distance entre les deux était un changement de contexte, un copier-coller de l’idée et un Brain qui repartait de zéro.

```bf-figure
{
  "kind": "compare",
  "title": "D’une idée prouvée à une application en marche",
  "columns": [
    { "title": "Avant", "hue": "muted", "items": ["Prouver l’idée sur le canevas", "Ouvrir Studio dans une autre fenêtre", "Réexpliquer l’idée à une nouvelle discussion", "Construire là-bas", "Revenir au canevas pour mesurer"] },
    { "title": "Maintenant", "hue": "make", "items": ["Prouver l’idée sur le canevas", "Appuyer sur App", "Continuer à parler au même Brain", "L’exécuter, puis Mesurer sur le même tableau"] }
  ],
  "caption": "Idée → Réaliser → Exécuter → Mesurer se déroule désormais sur une seule surface, avec une seule conversation portée à chaque étape."
}
```

Comme l’application vit sur le même tableau que la recherche, la preuve et les indicateurs, **Exécuter** et **Mesurer** s’enchaînent sans passation. Ce que vous mesurez est ce que le tableau a construit, et le Brain qui lit les chiffres est celui qui a écrit le code.

## Ce que vous pouvez en faire dès aujourd’hui

- **Ouvrir App sur n’importe quel canevas** et construire avec de vrais fichiers, des paquets et un serveur, sans quitter le tableau.
- **Continuer à construire avec Brain**, qui modifie désormais directement le code de votre application.
- **Transformer des cartes de code existantes en projet en marche** simplement en ouvrant App.
- **L’essayer sans compte**, et le conserver quand cela vaut la peine.
- **Passer d’une application à l’autre** sur le même tableau, ou ouvrir n’importe laquelle en plein écran dans Studio.

---

**À lire aussi :** [Builderforce Studio — décrivez une application, regardez-la tourner, gardez chaque version](/blog/builderforce-studio-describe-it-run-it) · [Exécutez l’application que votre tableau vient de construire](/blog/run-your-app-on-the-canvas) · [Créez avant de vous inscrire](/blog/create-before-you-sign-up)

[Ouvrez un canevas](/create), appuyez sur **App** et demandez quelque chose qui comporte un back-end.
