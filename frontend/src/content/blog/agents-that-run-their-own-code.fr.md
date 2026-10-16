Il y a une différence discrète entre un agent qui écrit du code et un agent qui le livre. Le premier vous remet des fichiers. Le second vous remet des fichiers qui compilent, dont les tests passent et dont les dépendances s’installent vraiment.

Jusqu’à aujourd’hui, le Brain du canevas et de l’espace de travail Studio était du premier genre. Il savait écrire un backend, une page et un fichier de tests, et il les écrivait bien, mais il n’avait aucun moyen d’en exécuter un seul. La vérification vous revenait donc. Vous ouvriez l’aperçu, trouviez l’erreur de type, la recolliez dans la conversation, attendiez un correctif, et recommenciez. L’agent était sûr de lui ; la preuve, c’était votre travail.

C’est ce manque que nous comblons. Le Brain exécute désormais son propre code.

## Ce que le Brain sait faire maintenant

Demandez une modification sur un build et le Brain peut lancer de vraies commandes dessus : `npm install` pour ajouter un paquet, `npm test` pour lancer les tests, `npm run build` pour l’empaqueter, `tsc` pour vérifier les types. Ce sont les commandes que vous taperiez dans un terminal. Quand l’une échoue, il lit la sortie, corrige le code qu’il vient d’écrire et relance la commande. Au moment où il vous dit que la modification est faite, elle a déjà passé les vérifications.

```bf-figure
{
  "kind": "screen",
  "frame": "Un build sur le canevas, pendant que le Brain vérifie sa propre modification",
  "ratio": 1.6,
  "regions": [
    { "label": "Fichiers", "note": "Le Brain les modifie, puis prouve la modification", "x": 3, "y": 8, "w": 30, "h": 86, "hue": "make" },
    { "label": "Sortie", "note": "npm install · npm test · npm run build · tsc", "x": 36, "y": 8, "w": 30, "h": 54, "hue": "prove" },
    { "label": "Aperçu", "note": "L’app en cours d’exécution reste ici, aux vraies largeurs", "x": 69, "y": 8, "w": 28, "h": 86, "hue": "run" },
    { "label": "Brain", "note": "« Sélecteur de date ajouté. 14 tests passent, le build est propre. »", "x": 36, "y": 66, "w": 30, "h": 28, "hue": "idea" }
  ],
  "caption": "La modification, la preuve et l’app en cours d’exécution sur un même tableau. Vous lisez un résultat, pas une supposition."
}
```

Tout s’exécute dans votre navigateur. Builderforce a son propre environnement d’exécution dans le navigateur, [BuilderForce WebContainers](/blog/builderforce-webcontainers-open-source), qui fait déjà tourner l’aperçu en direct. Les commandes du Brain s’exécutent dans ce même environnement, sur les mêmes fichiers, dans le même onglet. Rien n’est envoyé à un serveur de build et aucune machine n’est à provisionner. Les fichiers qu’une commande modifie, comme un `package.json` mis à jour ou un fichier source généré, sont enregistrés dans votre projet ; les paquets installés et les sorties de build restent à leur place, hors de votre code source.

Comme tout tourne dans votre propre navigateur, cela fonctionne avant même que vous ayez un compte. Lancez un tableau invité, demandez une app, et le Brain y prouve aussi son travail.

```bf-figure
{
  "kind": "flow",
  "title": "Comment le Brain termine une modification",
  "steps": [
    { "label": "Écrire", "note": "Le Brain modifie les fichiers du build selon votre demande.", "hue": "make" },
    { "label": "Exécuter", "note": "Il installe, teste, construit et vérifie les types dans votre navigateur.", "hue": "prove", "tag": "dans votre onglet" },
    { "label": "Corriger", "note": "Un échec revient sous forme de vraie sortie ; il corrige la cause et relance.", "hue": "build" },
    { "label": "Vous le dire", "note": "Vous apprenez la modification une fois qu’elle a passé, avec ce qu’il a lancé.", "hue": "measure", "tag": "vérifié" }
  ],
  "caption": "La boucle qu’une ingénieure rigoureuse parcourt avant de demander une revue, parcourue par le Brain avant de vous répondre."
}
```

Deux limites méritent d’être connues d’emblée. Les paquets qui ont besoin de modules natifs ou de binaires système ne tournent pas dans un navigateur, et le Brain vous le dira quand l’un d’eux pose problème plutôt que de faire semblant. Et l’app elle-même continue de tourner dans l’aperçu en direct, pas comme une commande : un serveur de développement ne se termine jamais, alors le Brain prouve avec des commandes qui se terminent et laisse l’exécution à l’aperçu, là où vous la voyez.

## Des réponses rapides sur votre propre machine

La même version rend les questions simples plus rapides et plus privées. Si le modèle intégré de Chrome est déjà sur votre ordinateur, un simple tour de conversation, où le Brain parle au lieu d’utiliser des outils, reçoit sa réponse directement sur votre appareil. Si ce modèle n’est pas disponible ou ne peut pas répondre, le tour passe aux modèles cloud de Builderforce sans que vous le remarquiez.

```bf-figure
{
  "kind": "compare",
  "title": "Où un tour du Brain reçoit sa réponse",
  "columns": [
    { "title": "Sur votre appareil", "hue": "run", "items": ["Conversation simple, sans outils", "Seulement si le modèle intégré de Chrome est déjà téléchargé", "Privé, et gratuit", "Le même niveau répond dans Rovr, l’assistant Builderforce pour Chrome"] },
    { "title": "Cloud Builderforce", "hue": "make", "items": ["Tout tour qui utilise des outils : modifier des fichiers, lancer des commandes", "Tout tour pour lequel vous avez choisi un modèle précis", "Chaque fois que le modèle de l’appareil manque ou ne peut pas répondre", "Repris sans bruit, avant que vous ayez vu un mot"] }
  ],
  "caption": "Votre choix de modèle l’emporte toujours. Le modèle de l’appareil ne répond qu’aux tours qui n’en ont jamais demandé un."
}
```

Il n’est jamais utilisé quand vous avez choisi un modèle vous-même, ni pour un tour qui a besoin d’outils : le Brain qui écrit, exécute et corrige votre code est toujours le modèle que vous attendez.

## Sa place dans la méthode

Le travail sur Builderforce suit un arc, **Idée → Fabriquer → Exploiter → Mesurer**, et chaque acte a la même boucle intérieure : [Lire, Prouver, Construire](/blog/read-prove-build-the-inner-loop). Cette version met cette boucle entre les mains du Brain lui-même, au moment précis où **Fabriquer** devient **Exploiter**.

- **Lire** est le point de départ. Avant de modifier un build, le Brain lit ses fichiers et, désormais, la vraie sortie de ses commandes : il travaille à partir de ce que fait le code, et non de ce qu’il espérait qu’il fasse.
- **Prouver** est la nouveauté. Une modification n’est pas terminée quand elle est écrite ; elle l’est quand elle s’installe, se construit, passe la vérification des types et réussit ses tests. C’est la plus petite preuve qui soit, avec le même réflexe qu’une **preuve de concept** : isoler la partie risquée et la confronter à une exigence avant de bâtir dessus.
- **Construire** se fait sur cette preuve. La modification suivante part d’un build dont on sait qu’il fonctionne, si bien qu’une session de dix modifications ne se termine pas sur dix inconnues.
- **Exploiter** reste là où vous pouvez le voir : l’aperçu en direct fait tourner l’app que le Brain vient de prouver, aux vraies largeurs d’appareil.
- **Mesurer** reçoit de meilleures données. Chaque modification qui y arrive a déjà passé ses propres vérifications : ce que vous mesurez, c’est l’idée, pas une coquille.

## Ce que vous pouvez faire dès aujourd’hui

- **Demander une fonctionnalité et en obtenir une qui se construit.** Le Brain lance le build et la vérification des types avant de vous dire que c’est fait.
- **Lui demander d’ajouter des tests, et de les faire passer.** Il écrit les tests, les lance et corrige le code jusqu’à ce qu’ils passent.
- **Ajouter un paquet par son nom.** Le Brain lance l’installation et met à jour `package.json` pour vous, dans le navigateur.
- **Essayer sans compte.** Les tableaux invités disposent du même environnement, car il tourne dans votre navigateur et nulle part ailleurs.
- **Obtenir des réponses rapides en local.** Si le modèle intégré de Chrome est sur votre machine, la conversation simple y reçoit sa réponse, en privé.

Ouvrez un tableau, décrivez l’app que vous voulez, et regardez le Brain prouver son propre travail avant de vous le remettre.

---

**À lire aussi :** [Exécutez l’app que votre tableau vient de construire](/blog/run-your-app-on-the-canvas) · [BuilderForce WebContainers est open source](/blog/builderforce-webcontainers-open-source) · [Voici Rovr](/blog/rovr-your-assistant-in-the-browser) · [Lire, Prouver, Construire](/blog/read-prove-build-the-inner-loop)
