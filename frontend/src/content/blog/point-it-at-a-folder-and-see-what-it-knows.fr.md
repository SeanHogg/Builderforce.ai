Il y a un an, vous lisiez le code avant de le fusionner. Aujourd'hui, un agent écrit quarante fichiers en un après-midi, et personne ne lit les quarante. Il en va de même pour les documents : spécifications, contrats, notes de recherche et politiques qu'un agent a rédigés, révisés, puis rédigés à nouveau.

Vous ne pouvez pas tout lire, et vous n'en avez pas besoin. Ce qu'il vous faut, c'est juger la **forme**. Est-ce organisé en couches comme vous l'aviez voulu ? La même chose est-elle écrite deux fois ? Un document dit-il le contraire d'un autre ? Les liens mènent-ils encore quelque part ?

Jusqu'ici, rien ne vous le montrait. Désormais, vous pointez BuilderForce vers un dossier, et il vous le montre.

## Demandez-lui de regarder

Depuis VS Code, depuis Rovr ou sur le canvas web, tapez `/review ./contracts`, ou demandez simplement : « passe en revue le dossier de facturation ». Dans VS Code, vous pouvez aussi faire un clic droit sur un dossier et choisir **Review with BuilderForce**.

Avant que quoi que ce soit ne s'exécute, vous voyez ce que la revue va faire : combien de fichiers elle va lire, combien n'ont pas changé depuis la dernière fois, et à peu près combien d'appels au modèle et combien d'argent coûtera la passe d'évaluation. Vous dites oui, et le graphe se construit sous vos yeux.

```bf-figure
{
  "kind": "flow",
  "title": "D'un dossier à un graphe sur lequel agir",
  "steps": [
    { "label": "Pointer", "note": "N'importe quel dossier : code, documents ou les deux. Tapez /review, demandez-le avec vos mots ou faites un clic droit dans VS Code.", "hue": "read" },
    { "label": "Confirmer", "note": "Voyez le nombre de fichiers, ce qui n'a pas changé et le coût approximatif avant toute dépense.", "hue": "accent", "tag": "vous décidez" },
    { "label": "Voir", "note": "Un graphe 3D du dossier s'ouvre, chaque problème trouvé y est déjà signalé.", "hue": "build" },
    { "label": "Corriger", "note": "Chaque constat a Fix with agent. Un clic transmet la demande à votre compositeur.", "hue": "good" }
  ],
  "caption": "Une deuxième revue ne relit que les fichiers modifiés : garder l'image à jour ne coûte presque rien."
}
```

## Ce que vous voyez

Le dossier s'ouvre sous la forme d'un graphe 3D que vous pouvez faire pivoter, zoomer et parcourir à la souris ou du doigt. Le code est posé sur des plans, un par couche. Les documents sont regroupés par dossier et par section. Plus un nœud est gros, plus le reste du dossier dépend de lui. Chaque flèche va de ce qui utilise vers ce qui est utilisé, et les flèches qui enfreignent vos règles s'allument.

```bf-figure
{
  "kind": "screen",
  "frame": "Un dossier passé en revue, dans VS Code",
  "ratio": 1.62,
  "regions": [
    { "label": "Le dossier en 3D", "note": "Couches en plans, zones en grappes, taille selon l'importance", "x": 4, "y": 8, "w": 62, "h": 66, "hue": "build" },
    { "label": "Constats", "note": "Couches enfreintes, doublons, contradictions, liens cassés", "x": 69, "y": 8, "w": 27, "h": 44, "hue": "bad" },
    { "label": "Fix with agent", "note": "Sur chaque constat", "x": 69, "y": 56, "w": 27, "h": 18, "hue": "good" },
    { "label": "Lentilles", "note": "Structure, couches, doublons, affirmations, liens, comparaison", "x": 4, "y": 80, "w": 62, "h": 14, "hue": "accent" },
    { "label": "Demander", "note": "Réponse tirée de la mémoire", "x": 69, "y": 80, "w": 27, "h": 14, "hue": "read" }
  ],
  "caption": "Une seule vue sur chaque hôte. VS Code, Rovr et le canvas web dessinent le même graphe du même dossier."
}
```

Changez de lentille pour poser une autre question au même dossier :

- **Couches.** Quels fichiers débordent de la couche à laquelle ils appartiennent, et lesquels forment une boucle.
- **Doublons.** Du code copié d'un endroit à un autre, et des sections ou des documents entiers qui disent presque la même chose.
- **Affirmations.** Là où un document en contredit un autre, et là où ils s'accordent.
- **Liens.** Chaque renvoi entre documents, les liens cassés étant signalés.
- **Inutilisé.** Fichiers, exports et dépendances que plus rien n'utilise.
- **Comparaison.** Cette revue face à la précédente, pour voir ce qui s'est amélioré et ce qui s'est dégradé.

Choisissez n'importe quel fichier et **tracez**-le. Dans le code, vous obtenez une séquence de couches : quelle couche a appelé laquelle, et où un appel a sauté une couche ou est remonté. Dans les documents, vous voyez comment l'un rejoint l'autre par les liens et les citations. Les deux traces se copient sous forme de diagramme à coller dans une pull request.

## Corrigez là où vous l'avez trouvé

Chaque constat a **Fix with agent**. Cela n'ouvre ni nouvelle conversation ni outil à part. Une demande toute prête arrive dans le compositeur que vous utilisez déjà : « Regrouper le groupe de clones n° 3 », « Placer l'import de la base de données derrière un port », « Réconcilier la section 4.2 de a.md avec la section 2 de b.md », « Réparer 3 liens cassés ». Vous la lisez, la modifiez si vous le souhaitez, et l'envoyez. Si vous savez sur un fichier quelque chose que le graphe devrait retenir, **Add fact** l'épingle à ce fichier pour chaque personne et chaque agent du projet.

## Posez la question, et souvent aucun modèle n'est nécessaire

Une fois passé en revue, le dossier est en mémoire. Les questions qui le concernent trouvent leur réponse dans cette mémoire, sans relire chaque fichier.

```bf-figure
{
  "kind": "compare",
  "title": "Poser une question sur un dossier",
  "columns": [
    { "title": "Avant", "hue": "muted", "items": ["Vous posez une question à l'agent", "Il ouvre et lit fichier après fichier", "Vous payez chaque fichier qu'il lit", "Vous reposez la question demain, et il relit tout"] },
    { "title": "Maintenant", "hue": "read", "items": ["Vous posez une question à l'agent", "La réponse vient du graphe en mémoire", "Souvent réglée sans aucun appel au modèle", "Vous reposez la question demain, et c'est tout aussi rapide"] }
  ],
  "caption": "/dup, /graph, /review et des questions comme « où la facturation est-elle gérée ? » sont reconnus avant tout appel au modèle. Quand le graphe est sûr, il répond ; sinon, le modèle part des faits au lieu de les chercher."
}
```

Tapez `/dup` et les doublons s'affichent. Tapez `/graph` et la vue s'ouvre sur les fichiers que vous avez nommés. Demandez « que dit le bail sur la résiliation ? » ou « où la facturation est-elle gérée ? » et la réponse revient avec les endroits d'où elle provient et ce qui les entoure. Quand le graphe peut répondre seul, aucun modèle n'est appelé et rien n'est dépensé. Quand il ne le peut pas, le modèle part des faits trouvés par le graphe au lieu de passer des tours à les chercher.

## Sa place dans la méthode

Le graphe sert deux étapes de l'arc [Idea to Real](/blog/idea-to-real-the-operating-methodology), une pour chaque type de dossier.

**Pour les documents, c'est Idea → Read.** [Read](/blog/read-prove-build-the-inner-loop) pose une seule question : *qu'avez-vous réellement dit ?* Quand « ce que vous avez dit » tient en trente spécifications et un dossier de contrats, la réponse honnête inclut les endroits où ils se contredisent. Jusqu'ici, seule la lecture de chaque fichier permettait de les trouver. Désormais, les contradictions, les quasi-copies et les liens morts sont à l'écran avant que quiconque décide quoi construire, et Read reste l'étape peu coûteuse qu'elle doit être.

**Pour le code, c'est Make → Build.** Build est l'étape qui dépense : agents, budget d'exécution, déploiements. Sa question est *est-ce réel ?*, et dès que les agents écrivent les lignes, la réponse dépend de la forme : respecte-t-il ses couches, est-il construit une seule fois, quelque chose utilise-t-il encore ceci ? La revue ligne à ligne cesse de passer à l'échelle quand ce n'est plus vous qui écrivez les lignes. Juger la forme, si, et une couche enfreinte repérée le jour où elle apparaît coûte bien moins cher que la même découverte après que trois nouvelles fonctionnalités s'y sont appuyées.

## Ce que vous pouvez faire dès aujourd'hui

- **Passer en revue n'importe quel dossier**, code ou documents, depuis VS Code, Rovr ou le canvas web, en voyant le coût avant de commencer.
- **Voir où vos couches cèdent** et quels fichiers forment une boucle, sur un graphe que vous pouvez parcourir.
- **Trouver le code dupliqué et les documents presque identiques** avant qu'ils ne divergent.
- **Repérer les documents qui se contredisent** et les liens qui ne mènent plus nulle part.
- **Tracer n'importe quel fichier** à travers les couches ou les documents qu'il atteint, et copier la trace en diagramme.
- **Faire corriger n'importe quel constat par un agent** en un clic, depuis le compositeur que vous utilisez déjà.
- **Interroger le dossier** et obtenir des réponses tirées de la mémoire, souvent sans payer d'appel au modèle.
- **Voir la dette technique baisser** en comparant cette revue à la précédente.

---

**À lire aussi :** [Read, Prove, Build : la boucle intérieure](/blog/read-prove-build-the-inner-loop) · [L'inférence par la mémoire d'abord : se passer du LLM](/blog/memory-first-inference-skip-the-llm) · [Un index local pour tous vos outils d'IA](/blog/one-local-index-for-every-ai-tool)

[Ouvrez un canvas](/create) et tapez `/review` suivi du dossier que vous ne lisez plus.
