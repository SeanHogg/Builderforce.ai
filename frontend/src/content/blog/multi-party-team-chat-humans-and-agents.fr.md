Sur la plupart des outils d'IA, « chat » signifie un humain qui écrit à un modèle. Chaque message déclenche le modèle ; impossible de faire entrer un collègue dans la conversation pour simplement lui parler, et impossible de confier la conversation à un agent spécialisé qui *agit* ensuite. Builderforce.ai a repensé le chat comme une **collaboration multipartite** — où certains participants sont des personnes et d'autres des agents, et où vous choisissez à qui s'adresse chaque message.

> Dans Builderforce.ai, les fils de discussion d'équipe sont partagés à l'échelle de votre projet : invitez des humains par e-mail, invitez des agents IA dans la conversation, puis adressez un message à un participant précis. Un message à un humain lui parle, tout simplement ; une mention `@agent` fait répondre cet agent en son propre nom et lance une boucle d'outils bornée, limitée par les permissions — sans jamais dépasser votre propre niveau d'accès.

![Un fil de discussion partagé avec une barre de participants montrant le propriétaire, un collègue invité par e-mail et un @agent ; un message au collègue reçoit la réponse d'une personne, tandis qu'un message à l'agent reçoit la réponse de l'agent, qui crée et relie des tâches](/blog/chat-shared-thread.svg)

## Chatbot ou chat d'équipe multipartite

| | Chat IA classique | Chat d'équipe Builderforce |
| --- | --- | --- |
| **Participants** | Un humain, un modèle | Plusieurs humains **et** plusieurs agents |
| **Ce que déclenche un message** | Chaque message déclenche le modèle | Vous adressez chaque message à une personne ou à un `@agent` |
| **Parler à un collègue** | Impossible | Adressez-le à un humain — la boucle de l'agent reste inactive |
| **L'agent agit** | Répond uniquement par du texte | Exécute une boucle d'outils limitée (tâches, OKR, tableau) en son propre nom |
| **Accès** | Sans objet | L'agent utilise **votre** rôle et votre jeton — jamais plus |
| **Visibilité du fil** | Privé, pour vous seul | Partagé avec le projet (ou verrouillé explicitement) |

## Des fils partagés, pas des silos privés

Un chat Builderforce est **global à son projet et à son tenant**. Un collègue peut le voir, l'ouvrir et le rejoindre pour collaborer — il est automatiquement enregistré comme membre la première fois qu'il contribue, si bien que l'audience du fil est réelle et vivante. Vous pouvez aussi **verrouiller** un fil pour le réserver à son propriétaire et aux membres explicitement invités, lorsqu'une conversation doit rester privée. Les propriétaires conservent le contrôle administratif (renommer, archiver, inviter, retirer, verrouiller) ; tous les autres collaborent.

## Invitez des humains par e-mail — même ceux qui ne font pas encore partie de l'équipe

Ajoutez un collègue à un fil par e-mail. S'il fait déjà partie de votre équipe, il reçoit une notification dans l'application (avec un webhook e-mail facultatif) et le fil apparaît dans sa liste. S'il n'est **pas** encore membre, l'invitation crée un enregistrement en attente : lorsqu'il s'inscrit, il est ajouté automatiquement et intégré au chat dès son premier accès — une arrivée fluide, sans étape supplémentaire. Une cloche de notifications globale dans la barre supérieure fait remonter les invitations et les mentions, et renvoie directement au fil.

## Adressez un message au bon participant

L'idée clé : un message a un **destinataire**. Dans la zone de saisie, vous choisissez « À : <nom> » (ou vous commencez simplement par `@name`), et Builderforce oriente le tour en conséquence :

- **À un humain** — le message est *destiné à cette personne*. Il est enregistré et remis, mais il ne déclenche **pas** le modèle. Aucun agent ne se réveille ; ce sont simplement des personnes qui se parlent.
- **À un `@agent`** — cet agent **répond en son propre nom**. Il exécute côté serveur une boucle d'outils bornée, sur une liste d'autorisations sélectionnée et non destructive (lire le tableau, créer une tâche de suivi, mettre à jour un OKR, lire les spécifications et la base de connaissances) — avec **votre** rôle et votre jeton, si bien qu'un agent ne peut jamais faire quoi que ce soit que vous ne pourriez pas faire. Sa réponse est publiée au nom de l'agent, avec son propre nom et son propre avatar.

![La zone de saisie oriente un message vers l'une de deux voies : vers un humain, où il est remis de personne à personne et la boucle de l'agent reste inactive ; ou vers un @agent, où il lance une boucle d'outils limitée par les permissions qui crée des tâches, met à jour des OKR et lit le tableau](/blog/collab-message-routing.svg)

Un fil peut donc contenir un vrai mélange : vous posez une question à un collègue, puis vous faites une `@mention` à un agent pour qu'il crée les tâches sur lesquelles vous venez de vous mettre d'accord.

## Régi par vos permissions, pas par celles de l'agent

Chaque action qu'un agent invité effectue dans le chat s'exécute avec les permissions de l'utilisateur qui l'a déclenchée. La liste d'autorisations du chat ne comporte aucune suppression ni aucun accès au plan de contrôle. Résultat : une collaboration digne de confiance — un agent dans la conversation est assez puissant pour être utile, et assez encadré pour être sûr.

## La même expérience sur le web et dans VS Code

Le chat multipartite est partagé entre les surfaces. Le Brain web et la webview VS Code utilisent le même routage des destinataires, la même liste de participants et les mêmes avatars — et l'arborescence native des Sessions affiche les participants de chaque fil sous forme de pastilles d'avatar colorées, pour voir d'un coup d'œil qui est dans la conversation. Invitez un humain sur le web, faites une `@mention` à un agent depuis VS Code — c'est une seule et même conversation.

## Pourquoi c'est important

Le vrai travail est une conversation entre plusieurs personnes et, de plus en plus, plusieurs agents. Traiter le chat comme un échange entre un humain et un modèle ne permet pas de représenter cela. En rendant les fils partagés, les participants explicites et `@agent` un véritable acteur lié à vos permissions, Builderforce fait du chat un lieu où toute une main-d'œuvre collabore — et pas seulement une zone de prompt.

## Questions fréquentes

**Puis-je parler à un collègue dans le chat sans déclencher de réponse de l'IA ?** Oui. Adressez le message à un humain (choisissez-le comme destinataire ou commencez par `@name`) et il est remis comme un message de personne à personne — la boucle de l'agent reste inactive.

**Que peut réellement faire un `@agent` quand je le mentionne ?** Il exécute une boucle d'outils bornée sur une liste d'autorisations sûre — lecture, plus écriture limitée (lire le tableau, créer des tâches, mettre à jour des OKR, lire les spécifications et la base de connaissances) — avec votre rôle et votre jeton. Il ne peut ni supprimer ni atteindre le plan de contrôle, et il ne peut jamais dépasser vos propres permissions.

**Puis-je inviter quelqu'un qui ne fait pas encore partie de mon équipe ?** Oui. Inviter une adresse e-mail inconnue crée une invitation en attente ; lorsque la personne s'inscrit, elle est ajoutée à l'équipe et intégrée automatiquement au chat dès son premier accès.

**Un chat m'est-il réservé ?** Par défaut, les fils sont partagés avec votre projet pour que vos collègues puissent les rejoindre. Vous pouvez verrouiller un fil pour que seuls le propriétaire et les membres explicitement invités y aient accès.

**Est-ce que cela fonctionne dans VS Code ?** Oui. La webview VS Code partage le même routage des destinataires, le même modèle de participants et les mêmes avatars que le Brain web — c'est une seule conversation, sur toutes les surfaces.
