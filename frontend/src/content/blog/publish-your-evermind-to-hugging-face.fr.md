# Publiez sur Hugging Face le modèle que vous avez entraîné, depuis la page où vous l’avez entraîné

Vous avez enseigné à un Evermind votre base de code, votre ton de support, votre style maison. Il a passé son contrôle de préparation. Il répond dans l’espace de travail. Et puis quelqu’un hors de l’espace de travail demande à l’essayer.

Jusqu’à aujourd’hui, la réponse honnête était un fichier zip. Le panneau d’export construisait tout le dépôt Hugging Face — poids au format safetensors, graphe ONNX, conteneur GGUF, configuration, tokeniseur et fiche de modèle — et vous le remettait sous forme de téléchargement. L’amener sur le Hub était votre affaire : le décompresser, installer les outils en ligne de commande, se connecter, créer le dépôt, envoyer les gros fichiers de la bonne manière et espérer que la fiche de modèle survive au voyage. C’est un petit projet logiciel qui se dresse entre un modèle terminé et les personnes qui pourraient l’utiliser.

## Publier, pas télécharger

Choisissez **Dépôt Hugging Face** dans le panneau d’export et une seconde section s’ouvre en dessous : **Publier sur Hugging Face**. Nommez le dépôt sous la forme `owner/name`, collez un jeton Hugging Face avec accès en écriture, choisissez si le dépôt démarre en privé, et publiez.

```bf-figure
{
  "kind": "flow",
  "title": "Ce qui se passe quand vous appuyez sur Publier",
  "steps": [
    { "label": "Exporter", "note": "Le serveur construit le même lot de dépôt que celui du téléchargement : safetensors, ONNX, GGUF, configuration, tokeniseur et fiche de modèle.", "hue": "make" },
    { "label": "Décompresser", "note": "Votre navigateur ouvre le lot pour en tirer les fichiers dont est fait un dépôt du Hub.", "hue": "run" },
    { "label": "Envoyer", "note": "Le dépôt est créé s’il n’existe pas, et chaque fichier est envoyé, les gros poids étant traités comme le Hub l’attend.", "hue": "reach", "tag": "votre jeton, votre dépôt" }
  ],
  "caption": "L’export lui-même est inchangé. Ce qui est nouveau, c’est le dernier saut : il n’exige plus de terminal, de connexion ni de second jeu d’outils."
}
```

Le lien vers le nouveau dépôt apparaît dès la fin de l’envoi. Toute personne avec qui vous le partagez peut charger le modèle avec les outils qu’elle utilise déjà.

```bf-figure
{
  "kind": "screen",
  "frame": "Le panneau d’export avec Hugging Face choisi",
  "ratio": 1.4,
  "regions": [
    { "label": "Modèle publié", "note": "N’importe quel Evermind publié par l’espace de travail", "x": 5, "y": 6, "w": 90, "h": 12, "hue": "make" },
    { "label": "Format : dépôt Hugging Face", "x": 5, "y": 21, "w": 90, "h": 12, "hue": "make" },
    { "label": "Exporter et télécharger", "note": "Toujours là, pour une copie hors ligne", "x": 5, "y": 36, "w": 40, "h": 9, "hue": "muted" },
    { "label": "Publier sur Hugging Face", "note": "Dépôt · votre jeton · privé ou public", "x": 5, "y": 49, "w": 90, "h": 45, "hue": "reach" }
  ],
  "caption": "La publication se place sous le téléchargement plutôt que de le remplacer. Le même lot sert aux deux : ce que vous publiez est exactement ce que vous auriez téléchargé."
}
```

## Votre jeton reste à vous

Le jeton va de la page directement à Hugging Face. Builderforce ne le reçoit jamais, ne le stocke jamais et n’en a jamais besoin. Le dépôt appartient à votre compte Hugging Face, pas au nôtre, et vous pouvez révoquer le jeton dès que vous avez terminé. C’est aussi pourquoi cela ne demande aucune configuration de notre côté : il n’y a aucune intégration à connecter et aucune clé à remettre.

## Sa place dans la méthode

L’arc va de Idée → Réaliser → Exécuter → Mesurer, puis **Portée** : mettre ce que vous avez fait devant les personnes à qui il est destiné. Un modèle qui ne répond qu’à l’intérieur de l’espace de travail qui l’a entraîné a été mesuré par ceux qui l’ont construit, pas par quiconque pourrait le vouloir. La Portée est l’étape où cela change, et jusqu’ici elle commençait par un travail de conditionnement manuel.

```bf-figure
{
  "kind": "compare",
  "title": "D’un modèle terminé à un modèle que d’autres peuvent charger",
  "columns": [
    { "title": "Avant", "hue": "muted", "items": ["Exporter et télécharger un zip", "Le décompresser", "Installer les outils en ligne de commande du Hub", "Se connecter", "Créer le dépôt", "Envoyer les poids comme de gros fichiers", "Vérifier que la fiche de modèle est bien arrivée"] },
    { "title": "Maintenant", "hue": "reach", "items": ["Choisir Dépôt Hugging Face", "Nommer le dépôt", "Coller votre jeton", "Publier"] }
  ],
  "caption": "Les étapes qui ont disparu n’étaient pas des décisions. C’était du conditionnement, et le conditionnement est l’endroit où un modèle terminé reste non partagé."
}
```

## Ce que vous pouvez en faire dès aujourd’hui

- **Partager publiquement un Evermind entraîné** sous votre propre compte Hugging Face, avec sa fiche de modèle, en une seule étape.
- **Démarrer en privé** et ouvrir le dépôt au monde quand vous êtes prêt.
- **Publier une nouvelle version** dans le même dépôt après avoir enseigné davantage au modèle. Publier à nouveau ajoute un nouveau commit au dépôt.
- **Garder la copie hors ligne** : le téléchargement reste à un clic, construit à partir du même lot.

---

**À lire aussi :** [Construire et entraîner un Evermind sur le Creation Canvas](/blog/build-and-train-evermind-on-the-creation-canvas) · [Evermind, le modèle auto-actualisé](/blog/evermind-self-updating-model) · [Dans l’architecture d’Evermind](/blog/inside-evermind-architecture)

Ouvrez le LLM Studio, exportez un modèle publié et choisissez **Dépôt Hugging Face**.
