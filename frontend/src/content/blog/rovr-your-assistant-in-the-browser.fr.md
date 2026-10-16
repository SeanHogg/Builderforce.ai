L'essentiel d'une journée de travail ne se passe ni dans un éditeur ni sur un canevas. Il se passe dans des onglets de navigateur : la note de frais, le portail fournisseur, la réservation, les douze pages que vous parcourez pour prendre une décision, le formulaire que vous remplissez pour la quatrième fois ce mois-ci.

L'agent de Builderforce savait écrire du code dans VS Code et construire sur un tableau. Dans le navigateur, il ne pouvait rien faire. Vous copiiez le texte d'une page, le colliez dans un chat, lisiez la réponse et retourniez cliquer vous-même. L'assistant savait énormément de choses et ne pouvait pas lever le petit doigt là où le travail se trouvait vraiment.

C'est ce manque que Rovr comble.

## Ce qu'est Rovr

Rovr est l'assistant de Builderforce pour le navigateur : une extension Chrome qui s'ouvre dans un panneau latéral à côté de la page où vous êtes. Vous lui dites ce dont vous avez besoin. Il lit la page, trouve les bons champs et les bons boutons, remplit ce qu'il faut, passe d'un onglet à l'autre et mène la tâche étape par étape, en vous disant au fur et à mesure ce qu'il a fait.

```bf-figure
{
  "kind": "screen",
  "frame": "Chrome avec Rovr ouvert à côté de la page",
  "ratio": 1.6,
  "regions": [
    { "label": "La page sur laquelle vous travaillez", "note": "Rovr la lit et agit dessus — uniquement sur les sites que vous avez autorisés", "x": 3, "y": 8, "w": 62, "h": 86, "hue": "run" },
    { "label": "Conversation", "note": "Vous demandez ; Rovr répond et agit", "x": 68, "y": 8, "w": 29, "h": 44, "hue": "idea" },
    { "label": "Carte de confirmation", "note": "Soumettre, acheter, envoyer, mot de passe : c'est vous qui dites oui", "x": 68, "y": 55, "w": 29, "h": 16, "hue": "accent" },
    { "label": "Actions · Tâches · Playbooks", "x": 68, "y": 74, "w": 29, "h": 20, "hue": "measure" }
  ],
  "caption": "Un panneau à côté de la page plutôt que par-dessus. La conversation, le journal de ce que Rovr a fait et les tâches qui en sont sorties sont au même endroit."
}
```

Trois choses le distinguent d'une fenêtre de chat qui se trouverait simplement à côté d'un navigateur.

**Il garde une trace de chaque action.** Chaque page qu'il lit, chaque clic, chaque champ qu'il remplit et chaque étape que vous avez refusée est consigné dans un journal des actions : ce qu'il a fait, sur quelle page et avec quel résultat. Vous pouvez le parcourir à tout moment, et il voyage avec la conversation : le journal que vous voyez dans le navigateur est celui que votre équipe voit dans Builderforce.

**Vous pouvez lui dire comment faire.** Les playbooks sont des instructions dans vos propres mots — *quand je dis « déclare mes notes de frais », ouvre le site des notes de frais, ajoute chaque reçu de ma boîte de réception et arrête-toi avant d'envoyer.* Quand une demande correspond, Rovr suit vos étapes au lieu d'improviser. Ils se synchronisent via votre profil Chrome et vous suivent dans chaque navigateur où vous êtes connecté.

**Il demande avant tout ce qui compte.** Rovr ne travaille que sur les sites que vous avez autorisés, et la première fois qu'il en a besoin d'un nouveau, il vous le demande. Tout ce qui soumet un formulaire, achète quelque chose, envoie ou publie un message, supprime quelque chose, ou touche un mot de passe ou un numéro de carte attend votre accord dans le panneau. Le contenu des pages est traité comme de l'information, jamais comme des instructions : une page web qui demande à Rovr de vous ignorer n'est qu'une page web qui dit quelque chose d'étrange.

## Privé par défaut, en ligne quand cela aide

Rovr fait d'abord tourner son modèle sur votre propre ordinateur. Si Synapse, Ollama ou FreeToken est lancé, c'est là que vont vos demandes : aucun compte nécessaire, aucun compteur, rien ne quitte votre machine. Quand une étape demande plus que ce que votre modèle local peut faire — une longue tâche avec beaucoup d'outils, par exemple —, Rovr confie cette étape aux modèles cloud de Builderforce, de façon invisible, avant que vous ayez vu un seul mot de la réponse.

```bf-figure
{
  "kind": "flow",
  "title": "Où s'exécute une étape de Rovr",
  "steps": [
    { "label": "Sur cet appareil", "note": "Un modèle local capable répond en premier. Privé, gratuit et disponible hors ligne.", "hue": "run", "tag": "d'abord" },
    { "label": "Cloud Builderforce", "note": "Si rien en local ne convient, ou si le modèle local échoue avant de répondre, l'étape passe au cloud.", "hue": "make" },
    { "label": "Votre espace de travail", "note": "La conversation, chaque action consignée et les tâches produites se synchronisent avec Builderforce dès que vous êtes en ligne.", "hue": "measure", "tag": "plus tard, c'est bien aussi" }
  ],
  "caption": "La décision se prend à chaque étape : une même tâche peut traiter ses étapes simples sur votre machine et n'envoyer au cloud que les plus lourdes."
}
```

Et il fonctionne hors ligne. Commencez une conversation dans un train sans réseau : il continue avec votre modèle local ; la conversation, ses actions et ses tâches sont enregistrées sur votre appareil et mises en file d'attente. Quand la connexion revient, elles se synchronisent avec votre espace de travail dans l'ordre, chacune exactement une fois.

## Des tâches qui arrivent là où votre équipe peut les voir

Quand vous demandez à Rovr de se souvenir de quelque chose — *relancer le propriétaire vendredi*, *renouveler le domaine avant qu'il n'expire* — ou qu'une tâche fait apparaître du travail de suivi, il ajoute une tâche à la conversation. Choisissez un projet dans les paramètres, et chaque tâche est créée dans ce projet et reliée à la conversation qui l'a produite, pour que la personne qui la reprend voie exactement d'où elle vient.

```bf-figure
{
  "kind": "compare",
  "title": "Un agent de navigateur dans le cloud d'un autre, et Rovr",
  "columns": [
    { "title": "Un agent de navigateur distant", "hue": "muted", "items": ["Tourne dans un navigateur sur le serveur de quelqu'un d'autre", "Vos pages et vos connexions y transitent", "S'arrête quand vous êtes hors ligne", "Ce qu'il a fait reste dans son propre historique"] },
    { "title": "Rovr", "hue": "run", "items": ["Tourne dans votre propre Chrome, avec vos propres sessions", "D'abord sur votre machine ; le cloud seulement si nécessaire", "Continue hors ligne et synchronise plus tard", "Chaque action consignée, synchronisée avec votre conversation, tâches dans vos projets"] }
  ],
  "caption": "Rovr agit dans le navigateur où vous êtes déjà connecté, sur les sites que vous autorisez. Rien de vos connexions ne quitte la machine."
}
```

## Sa place dans la méthode

Le travail sur Builderforce suit un arc, **Idée → Faire → Exécuter → Mesurer**, avec la même boucle interne dans chaque acte : [Lire, Prouver, Construire](/blog/read-prove-build-the-inner-loop). Rovr apporte cette boucle dans l'onglet où vous êtes déjà.

- **Idée** commence là où vous remarquez quelque chose. Interrogez Rovr sur la page devant vous et la question devient une conversation, avec la page comme preuve.
- **Lire** est la première chose que Rovr fait à chaque tâche : il regarde la page avant d'y toucher et ne devine jamais un bouton qu'il n'a pas vu.
- **Prouver**, c'est la carte de confirmation. Avant toute action qui a des conséquences, vous voyez ce que Rovr s'apprête à faire et pourquoi il demande.
- **Exécuter**, c'est la tâche elle-même, menée étape par étape, d'abord sur votre machine.
- **Mesurer**, ce sont le journal des actions et les tâches. Ce qui s'est passé est consigné et synchronisé, si bien que la prochaine exécution — la vôtre ou celle d'un collègue — part de ce que celle-ci a fait.

## Ce que vous pouvez faire dès aujourd'hui

- **Mener une tâche à bien sur un site sans cliquer vous-même** — remplir un formulaire, rassembler des chiffres sur trois pages, trouver le réglage caché à quatre menus de profondeur.
- **Écrire une fois comment vous voulez que les choses soient faites**, sous forme de playbook, et laisser Rovr le suivre à chaque fois.
- **Continuer à travailler sans connexion** avec un modèle qui tourne sur votre propre ordinateur, et laisser la conversation se synchroniser à votre retour en ligne.
- **Transformer une conversation en travail suivi** — les tâches créées par Rovr arrivent dans votre projet, reliées à la conversation qui les a créées.
- **Voir exactement ce qui s'est passé** — chaque action, sur chaque page, dans l'ordre, dans le navigateur et dans Builderforce.

Ajoutez Rovr à Chrome, connectez-vous avec votre compte Builderforce (ou non, et travaillez entièrement sur votre propre machine), autorisez un site et demandez.

---

**À lire aussi :** [L'IA local-first avec WebGPU dans le navigateur](/blog/local-first-ai-webgpu-in-the-browser) · [L'open source chez Builderforce](/blog/open-source-at-builderforce) · [Lire, Prouver, Construire](/blog/read-prove-build-the-inner-loop)
