Chaque assistant que vous utilisez apprend quelque chose sur vous. Les projets qui comptent pour vous, la façon dont vous nommez les choses, les étapes d'une tâche mensuelle que vous faites toujours à la main. Et presque tous gardent ce savoir sur le serveur de quelqu'un d'autre, dans un modèle qui ne vous appartiendra jamais et qui vous oublie dès que vous changez d'outil.

Voilà le manque : **ce que votre IA apprend de votre travail ne vous appartient pas.**

Synapse a été conçu pour le combler. C'est l'application de bureau de Builderforce, et c'est là que vit votre propre Evermind : les faits, démonstrations et compétences que vos outils captent sont stockés et entraînés sur votre ordinateur, dans un modèle `.evermind` qui est à vous. Jusqu'ici, il dépendait encore du cloud pour trois choses : le modèle qui vous répondait, les outils qu'il pouvait atteindre, et votre présence au bureau quand un agent avait besoin d'un oui. Les trois restent désormais chez vous.

```bf-figure
{
  "kind": "flow",
  "title": "Ce qui vit désormais sur votre machine",
  "steps": [
    { "label": "Votre Evermind", "note": "Faits, démonstrations et compétences, entraînés dans un modèle qui vous appartient. Partez de l'un des modèles de votre espace de travail.", "hue": "idea" },
    { "label": "Modèles locaux", "note": "Installés et dimensionnés pour votre mémoire ; le Brain peut répondre avec l'un d'eux, Claude Code aussi.", "hue": "make" },
    { "label": "Connecteurs", "note": "GitHub, Slack, Playwright, vos fichiers — des serveurs MCP utilisés par le Brain, exécutés ici.", "hue": "make" },
    { "label": "Approbations partout", "note": "Une étape d'agent qui attend un oui arrive sur votre téléphone via votre propre compte.", "hue": "run", "tag": "sur activation" }
  ],
  "caption": "Rien dans cette liste ne quitte l'ordinateur sans que vous le choisissiez — approbations sur téléphone comprises."
}
```

## Un modèle à la mesure de votre machine

Choisir un modèle local, c'est un petit examen d'arithmétique : nombre de paramètres, formats de quantification, mémoire restante une fois le navigateur et l'éditeur ouverts. La plupart des gens devinent, téléchargent onze gigaoctets et découvrent que ça ne tient pas.

Synapse fait le calcul. Il gère Ollama pour vous et lit la quantité de mémoire de l'ordinateur. Pour chaque modèle de son catalogue, il détermine quelle quantification laisse de la place pour tout le reste — pleine précision quand elle tient, huit bits sinon, quatre bits pour les plus gros — et il désigne un modèle comme le meilleur choix général pour cette machine. L'installation tient en un clic, avec sa progression ; la suppression, en un autre.

```bf-figure
{
  "kind": "screen",
  "frame": "Synapse — Modèles locaux",
  "ratio": 1.4,
  "regions": [
    { "label": "Le Brain répond avec", "note": "Builderforce par défaut, ou n'importe quel modèle installé", "x": 4, "y": 6, "w": 92, "h": 14, "hue": "idea" },
    { "label": "Modèles pour cette machine", "note": "Chaque taille avec la quantification qui tient ; un modèle marqué Recommandé", "x": 4, "y": 24, "w": 92, "h": 44, "hue": "make" },
    { "label": "Les utiliser depuis d'autres outils", "note": "Formats OpenAI et Anthropic sur un port local, avec une clé", "x": 4, "y": 72, "w": 92, "h": 22, "hue": "run" }
  ],
  "caption": "Un modèle trop gros pour cette machine le signale avant le téléchargement, pas après."
}
```

Ensuite, les modèles sont à vous, partout. Activez **Les utiliser depuis d'autres outils** et Synapse les sert sur votre ordinateur dans les deux formats que parlent les outils d'IA — celui d'OpenAI et celui d'Anthropic, qu'utilise Claude Code. Deux variables d'environnement, et Claude Code tourne sur un modèle qui ne quitte jamais la pièce. Seuls les programmes de la machine qui détiennent la clé peuvent entrer, et les pages web sont refusées d'office.

## Des outils pour le Brain, sans céder les clés

Le Brain de Synapse utilisait déjà les outils de la plateforme — tickets, tableaux, spécifications. Il utilise désormais aussi des **connecteurs** : des serveurs MCP qui tournent sur votre ordinateur. Choisissez GitHub, Slack, Brave Search, Playwright, Context7 ou un dossier de fichiers dans le catalogue et installez-le en un clic, ou ajoutez n'importe quel serveur MCP par sa ligne de commande.

Les jetons vont dans le magasin d'identifiants de votre système, jamais dans un fichier de paramètres. Un outil qui ne fait que lire s'exécute tout de suite ; un outil qui modifie quelque chose — ouvrir un ticket, publier un message, écrire un fichier — apparaît dans la discussion avec Approuver et Refuser, comme ceux de la plateforme.

```bf-figure
{
  "kind": "compare",
  "title": "Où l'outil s'exécute",
  "columns": [
    { "title": "Un assistant hébergé", "hue": "muted", "items": ["Vos jetons stockés sur ses serveurs", "Les outils n'atteignent que ce que le cloud atteint", "Vos fichiers locaux sont hors de portée"] },
    { "title": "Connecteurs Synapse", "hue": "make", "items": ["Jetons dans le magasin d'identifiants de votre système", "Serveurs exécutés sur votre machine, à côté de vos fichiers", "Tout ce qui modifie quelque chose demande d'abord"] }
  ],
  "caption": "Les mêmes serveurs MCP, là où se trouve déjà votre travail."
}
```

## Dites oui depuis votre téléphone

Les agents à qui vous apprenez une fois — enregistrez une tâche dans n'importe quelle application de bureau, laissez Synapse la refaire — s'arrêtent aux étapes qui comptent et attendent votre approbation. Jusqu'ici, cela voulait dire vous attendre au bureau. Activez **Approuver les étapes depuis votre téléphone** et la demande part aussi vers votre compte Builderforce, où la file des approbations l'affiche sur n'importe quel téléphone. La première réponse l'emporte, d'un côté comme de l'autre ; l'autre côté en est informé.

Tout est conçu pour que rien n'entre qui ne devrait pas. Synapse n'ouvre jamais de port vers Internet : la demande remonte par votre propre compte connecté, et Synapse va chercher la réponse. Vous seul pouvez la voir ou y répondre — ni un coéquipier, ni un responsable, ni une règle d'approbation automatique, ni un autre outil d'IA. Et la description de l'étape ne quitte votre ordinateur que tant que ce réglage est activé.

## Un modèle pour commencer

Votre Evermind apprend de ce que vivent vos outils, mais il lui faut un modèle dans lequel apprendre, et rares sont ceux qui ont un fichier `.evermind` sous la main. Synapse en propose désormais un : choisissez n'importe quel modèle Evermind que votre espace de travail possède déjà et cliquez sur **Utiliser comme mon modèle**. Il se télécharge sur votre ordinateur, avec son tokenizer, et apprend désormais là — l'espace de travail ne voit jamais ce qu'il apprend, sauf si vous le publiez.

## Sa place dans la méthode

Builderforce fait parcourir à chaque idée un même arc — [Idée, Faire, Exploiter, Mesurer](/blog/read-prove-build-the-inner-loop) — et chaque acte y suit la boucle Lire, Prouver, Construire.

Cette version porte sur **Exploiter**. Exploiter, c'est là où le travail continue quand vous ne regardez pas, et c'est là qu'une configuration privée cassait : l'agent s'arrêtait à sa première validation parce que vous n'étiez pas au bureau, le modèle derrière la réponse appartenait à quelqu'un d'autre, et les outils qu'il pouvait utiliser étaient ceux que le cloud atteignait. Les approbations sur téléphone font avancer l'exécution. Les modèles locaux et les connecteurs la font tourner là où se trouvent déjà votre travail et vos données.

Elle alimente aussi la **Lecture** de la prochaine fois. Ce qu'une exécution apprend à votre Evermind reste dans un modèle qui vous appartient : la prochaine fois que vous ou l'un de vos outils lirez votre travail, ce sera avec tout ce que vous avez déjà fait.

## Ce que vous pouvez faire dès aujourd'hui

- **Installer en un clic un modèle local** adapté à votre ordinateur, et laisser le Brain répondre avec.
- **Faire pointer Claude Code vers votre propre machine** avec les deux lignes que Synapse vous affiche.
- **Donner au Brain GitHub, Slack ou vos fichiers** comme outils, chaque modification attendant votre Approuver.
- **Approuver l'étape d'un agent depuis votre téléphone** au lieu de revenir au bureau.
- **Démarrer votre Evermind privé** à partir d'un modèle que votre espace de travail possède déjà.

[Téléchargez Synapse](https://github.com/SeanHogg/Builderforce.ai/releases?q=desktop-v&expanded=true) pour Windows, macOS ou Linux.

---

**À lire aussi :** [Un cerveau privé sur votre bureau, qui confie le travail à vos agents](/blog/a-private-brain-on-your-desktop-that-hands-work-to-agents) · [Montrez-le une fois, il le refera](/blog/teach-it-once-and-it-does-it-again) · [Un index local pour chaque outil d'IA de votre machine](/blog/one-local-index-for-every-ai-tool)
