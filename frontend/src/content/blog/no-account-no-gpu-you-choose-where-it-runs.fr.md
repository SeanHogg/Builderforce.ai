Commencer quelque chose s’accompagnait de trois conditions que personne n’écrivait nulle part.

Il fallait un **compte**, parce que la première chose que faisait la page était d’appeler un serveur, et que le serveur voulait savoir qui posait la question. Il fallait un **GPU**, parce que faire tourner un modèle sur sa propre machine voulait dire WebGPU, et qu’un portable sans carte capable se voyait poliment conseiller d’utiliser le cloud. Et il fallait un **réseau**, parce que, quelle que soit la porte d’entrée, les mots que vous tapiez partaient quelque part.

Aucune de ces conditions n’est une raison d’empêcher quelqu’un de réfléchir. Une idée à onze heures du soir, sur un portable professionnel à puce graphique intégrée, dans un train, reste une idée. Cette version supprime les trois conditions et ajoute ce qui aurait dû les accompagner dès le départ : un choix simple sur l’endroit où vos mots ont le droit d’aller.

```bf-figure
{
  "kind": "compare",
  "title": "Ce qu’il fallait pour poser la première question",
  "columns": [
    { "title": "Avant", "hue": "muted", "items": ["Créer un compte", "Attendre que l’espace de travail contacte le serveur", "Avoir un GPU compatible WebGPU, ou passer par le cloud", "Être en ligne", "Faire confiance au réglage par défaut sur la destination de vos mots"] },
    { "title": "Maintenant", "hue": "idea", "items": ["Ouvrez Studio ou Rovr", "Un modèle sur cet appareil répond", "Sur le GPU si vous en avez un, sur le CPU sinon", "Hors ligne une fois téléchargé", "Choisissez Local uniquement, Hybride ou Spécifique, et voyez quand il bascule"] }
  ],
  "caption": "Se connecter reste utile — Hybride par défaut, synchronisation, comptes connectés et mémoire —, mais c’est désormais un choix, pas une barrière devant le premier mot."
}
```

## Une question, la même sur chaque surface

Ouvrez le menu `/` dans le compositeur, choisissez **Model (Modèle)**, et la première chose que vous voyez est **Exécuter les modèles**. Il propose trois réponses, qui veulent dire la même chose sur builderforce.ai, dans l’extension VS Code et dans le panneau latéral Rovr de Chrome.

```bf-figure
{
  "kind": "screen",
  "frame": "Menu / · Modèle · Exécuter les modèles",
  "ratio": 1.7,
  "regions": [
    { "label": "Local uniquement", "note": "Uniquement les modèles de cet appareil. Rien n’est envoyé au cloud : ni un prompt, ni une connexion en direct", "x": 3, "y": 8, "w": 94, "h": 22, "hue": "good" },
    { "label": "Hybride · Recommandé", "note": "Cet appareil d’abord, puis le cloud quand c’est nécessaire, avec un avis quand cela arrive", "x": 3, "y": 36, "w": 94, "h": 22, "hue": "idea" },
    { "label": "Modèle spécifique", "note": "Le modèle choisi s’exécute toujours : un modèle cloud, l’un de vos comptes connectés ou un modèle local", "x": 3, "y": 64, "w": 94, "h": 22, "hue": "make" },
    { "label": "Modifiable à tout moment", "x": 3, "y": 90, "w": 40, "h": 7, "hue": "accent" }
  ],
  "caption": "Trois réponses, pas une page de réglages. Les trois mêmes sur le web, dans votre éditeur et dans le panneau latéral du navigateur : un choix fait une fois veut dire la même chose partout où vous travaillez."
}
```

**Local uniquement** est une promesse, pas une préférence. Dans ce mode, les requêtes de contenu sont bloquées avant de partir, tout comme les connexions en direct — les canaux qui, sinon, synchroniseraient un canevas ou diffuseraient une exécution vers un serveur. Si aucun modèle de cet appareil ne peut répondre, on vous le dit et on vous propose deux issues : en télécharger un, ou passer en Hybride. Rien ne part discrètement vers le cloud à votre place.

**Hybride** est le mode par défaut une fois connecté. Un modèle de votre appareil prend le tour en premier ; s’il ne peut pas, l’offre cloud gratuite prend le relais ; et quand cette bascule a lieu, un avis s’affiche, pour que vous sachiez toujours de quel côté de la ligne vient une réponse.

**Modèle spécifique** est strict. Vous choisissez un modèle, et c’est ce modèle qui s’exécute — pas de substitution, pas de solution de repli déguisée en ce que vous avez demandé. C’est le mode des comparaisons, des benchmarks, ou des tâches pour lesquelles vous savez exactement quel modèle vous voulez.

```bf-figure
{
  "kind": "compare",
  "title": "Où vos mots peuvent aller, selon le mode",
  "columns": [
    { "title": "Local uniquement", "hue": "good", "items": ["Cet appareil", "Bloquées : requêtes de contenu", "Bloquées : connexions en direct", "Fonctionne hors ligne"] },
    { "title": "Hybride", "hue": "idea", "items": ["Cet appareil d’abord", "Puis l’offre cloud gratuite", "Un avis quand il bascule", "Apprend quels tours garder en local"] },
    { "title": "Spécifique", "hue": "make", "items": ["Exactement le modèle choisi", "Cloud, votre propre compte ou un modèle local", "Aucune substitution silencieuse"] }
  ],
  "caption": "Le mode est la frontière. Tout le reste — quel modèle local, quel modèle cloud — se joue à l’intérieur."
}
```

## Sans compte, sans appel d’API

Studio et Rovr démarrent désormais de façon **anonyme**. Pas d’inscription, pas d’appel à nos serveurs pour commencer : la page se charge, un modèle local se charge dans votre navigateur, et vous travaillez. Tout ce que vous faites dans cet état reste sur votre appareil, parce que cela n’a nulle part ailleurs où aller.

Se connecter ajoute ce qui a réellement besoin d’un compte : Hybride par défaut, synchronisation entre appareils, comptes de fournisseurs connectés et mémoire de ce que vous avez déjà fait. Si vous voulez le cloud sans compte, choisir **Hybride** en tant qu’invité active une petite allocation invité ; c’est le seul moment où les mots d’un invité quittent l’appareil, et c’est vous qui l’avez choisi.

Cela prolonge [créer avant de s’inscrire](/blog/create-before-you-sign-up) sur le canevas. La différence, c’est que le modèle qui vous répond n’a plus besoin de vivre ailleurs.

## Sans GPU

La [version précédente](/blog/models-that-run-on-your-machine) apportait des modèles que l’on télécharge une fois et que l’on exécute sur le GPU du navigateur — en reconnaissant honnêtement qu’il fallait WebGPU. Cette limite a disparu. Les modèles **Bonsai** 1 bit tournent désormais aussi sur le **CPU**, répartis sur plusieurs threads quand le navigateur le permet, dans un worker en arrière-plan pour que la page reste réactive pendant que le modèle réfléchit.

```bf-figure
{
  "kind": "flow",
  "title": "Où tourne un modèle local, selon la surface",
  "steps": [
    { "label": "builderforce.ai", "note": "Studio et le canevas : le GPU quand WebGPU est disponible, sinon le CPU, toujours dans un worker en arrière-plan.", "hue": "idea" },
    { "label": "Rovr", "note": "Le panneau latéral de Chrome exécute les mêmes modèles de la même façon : le GPU d’abord, le CPU s’il n’y en a pas.", "hue": "run" },
    { "label": "VS Code", "note": "L’extension utilise le GPU du panneau de l’éditeur quand il en a un, et tourne sur le CPU dans l’extension elle-même sinon.", "hue": "make", "tag": "les deux voies" }
  ],
  "caption": "Le même modèle et le même sélecteur sur les trois. Un portable à puce graphique intégrée, un poste de travail verrouillé et un bureau virtuel peuvent maintenant faire tourner un modèle."
}
```

Un CPU est plus lent qu’un bon GPU ; inutile de prétendre le contraire. Mais un modèle qui répond en quelques secondes sur la machine que vous avez vaut mieux qu’un modèle qui refuse de se charger sur celle que vous n’avez pas. Pour une reformulation, un résumé, une question sur une page ou un premier jet de plan, c’est largement suffisant — et c’est privé par construction.

Pour savoir comment sont construits les moteurs embarqués dans le navigateur, lisez [L’IA local-first dans le navigateur, bien faite](/blog/local-first-ai-webgpu-in-the-browser).

## Un Hybride qui apprend quels tours garder

Un « local d’abord » naïf a un coût évident : chaque tour que le modèle local ne sait pas traiter est un tour où vous attendez qu’il échoue avant que le cloud ait sa chance. Si cela arrive souvent, Hybride paraît plus lent que le cloud seul.

Alors Hybride apprend. Un petit prédicteur sur votre appareil observe l’issue de vos propres tours — ceux que le modèle local a traités, ceux qu’il a passés — et, avec le temps, envoie **directement au cloud** les tours qu’il s’attend déjà à voir échouer en local, sans le détour.

```bf-figure
{
  "kind": "flow",
  "title": "Un tour en Hybride",
  "steps": [
    { "label": "Prédire", "note": "Appris de vos propres résultats, sur votre appareil : le modèle local va-t-il s’en sortir ?", "hue": "prove" },
    { "label": "Local", "note": "Si oui, cet appareil répond. Rien ne sort.", "hue": "good" },
    { "label": "Cloud gratuit", "note": "Si non — ou si la tentative locale n’aboutit pas —, l’offre gratuite prend le tour.", "hue": "run" },
    { "label": "Avis", "note": "Vous voyez la bascule, à chaque fois.", "hue": "accent", "tag": "jamais en silence" }
  ],
  "caption": "Le prédicteur apprend de ce qui est arrivé à vos tours, et il reste sur votre appareil. Plus vous utilisez Hybride, moins de tours attendent une tentative locale vouée à l’échec."
}
```

Deux changements plus modestes se trouvent derrière. Quand un tour part effectivement vers le cloud, **les modèles gratuits passent en premier dès qu’ils sont équivalents à un modèle payant** — une préférence de compte, déduite du fait que vous avez connecté ou non vos propres clés de fournisseur, et que vous pouvez modifier. Et **Insights** signale désormais les **anomalies d’exécution** : les exécutions qui ont coûté beaucoup plus, duré beaucoup plus longtemps ou fait échouer beaucoup plus d’outils que les précédentes, pour qu’une valeur aberrante soit quelque chose que vous voyez, et non quelque chose que vous découvrez sur une facture.

## Sa place dans la méthode

Le travail sur Builderforce suit un arc, **Idée → Fabriquer → Exécuter → Mesurer → Atteindre**, et la boucle qui fait passer de l’Idée à la Fabrication est [Lire, Prouver, Construire](/blog/read-prove-build-the-inner-loop). Lire et Prouver sont les deux actes censés ne rien coûter, pour que la décision de construire soit une vraie décision.

Cette version rend cela littéralement vrai, et elle se situe tout au début de l’arc : **l’Idée**.

```bf-figure
{
  "kind": "flow",
  "title": "Les deux premiers actes, sans rien devant eux",
  "steps": [
    { "label": "Lire", "note": "Approfondissez l’idée avec un modèle sur votre propre machine : sans compte, sans GPU, sans réseau, sans trace nulle part.", "hue": "read", "tag": "Idée" },
    { "label": "Prouver", "note": "Faites les vérifications peu coûteuses en local ; Hybride n’envoie au cloud que les tours qui en ont besoin, modèles gratuits d’abord.", "hue": "prove", "tag": "Idée" },
    { "label": "Construire", "note": "Connectez-vous quand le travail le mérite : synchronisation, comptes connectés et projet durable vous attendent.", "hue": "build", "tag": "Fabriquer" }
  ],
  "caption": "Lire et Prouver ont toujours dû être gratuits. Ils le sont désormais en coût, en inscription et en matériel — et Local uniquement les rend privés par règle, non par espoir."
}
```

Le moment le plus coûteux d’un projet n’est pas la construction. C’est l’idée qui n’a jamais reçu de première question, parce que cette question coûtait une inscription, un GPU ou une connexion que quelqu’un n’avait pas. Sortir ces coûts de la phase Idée, c’est permettre à davantage d’idées d’arriver jusqu’à Prouver — et repérer celles qui ne devraient pas être construites avant que quiconque ne s’y mette. Les anomalies d’exécution dans Insights ferment l’autre bout : les exécutions qui ont lieu sont mesurées, et les valeurs aberrantes vous reviennent.

## Ce que vous pouvez faire dès aujourd’hui

- **Commencer sans compte.** Ouvrez Studio ou Rovr et posez votre première question ; un modèle sur votre appareil répond.
- **Tout garder sur votre machine, par règle.** Choisissez **Local uniquement** et rien n’est envoyé : ni vos prompts, ni une connexion en direct.
- **Faire tourner un modèle sur n’importe quel portable.** Pas de GPU, pas de problème : Bonsai tourne sur le CPU sur le web, dans Rovr et dans VS Code.
- **Laisser Hybride choisir la route.** Local d’abord, cloud gratuit ensuite, un avis quand il bascule — et moins de tentatives locales gaspillées au fil du temps.
- **Épingler un modèle quand cela compte.** **Modèle spécifique** exécute exactement ce que vous avez choisi, sans substitution silencieuse.
- **Repérer les exécutions coûteuses.** Insights signale les exécutions très éloignées de la normale en coût, en durée et en échecs d’outils.

Ouvrez le menu `/`, choisissez **Model (Modèle)**, et décidez comment il doit s’exécuter.

---

**À lire aussi :** [Faites tourner un modèle sur votre propre machine](/blog/models-that-run-on-your-machine) · [L’IA local-first dans le navigateur, bien faite](/blog/local-first-ai-webgpu-in-the-browser) · [Découvrez Rovr](/blog/rovr-your-assistant-in-the-browser) · [Créer avant de s’inscrire](/blog/create-before-you-sign-up) · [Lire, Prouver, Construire](/blog/read-prove-build-the-inner-loop)

[Ouvrez Studio](/studio) et posez-lui une question — sans compte.
