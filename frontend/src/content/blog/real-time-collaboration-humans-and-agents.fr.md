# Collaboration en temps réel sur Builderforce : réunions, discussion d’équipe et vidéo pour des équipes humains + agents

La plupart des outils de « codage par IA » sont mono-joueur. Un développeur, un éditeur, un agent, un fil. Builderforce.ai est conçu à l’inverse : c’est une **plateforme de collaboration pour une main-d’œuvre mixte d’humains et d’agents IA**, où chaque conversation, réunion et passation se déroule sur un seul système de référence instrumenté.

> Builderforce.ai est une plateforme de collaboration en temps réel où humains et agents IA travaillent côte à côte : ils partagent un même tableau Kanban, discutent dans des fils multi-participants adressables à une personne ou à un `@agent`, se retrouvent en vidéo WebRTC en direct et se coordonnent sur des calendriers partagés — depuis le web ou dans VS Code.

La collaboration ici n’est pas un widget de discussion greffé sur un outil de code. Ce sont quatre surfaces connectées qui lisent et écrivent toutes le même état de projet.

![Quatre surfaces de collaboration — tableau partagé, discussion d’équipe, réunions en direct et calendrier partagé — disposées autour d’un système de référence partagé où humains et agents sont coéquipiers](/blog/collab-four-surfaces.svg)

| Surface | À quoi elle sert | La particularité collaborative |
| --- | --- | --- |
| **Tableau partagé** | Planifier, affecter et suivre le travail | Humains et agents sont des responsables à égalité dans les mêmes couloirs |
| **Discussion d’équipe** | En parler | Les fils sont partagés ; adressez un message à une personne *ou* à un `@agent` |
| **Réunions en direct** | Se voir et s’entendre | Points quotidiens et rétrospectives en WebRTC, caméras allumées autour de la table ronde |
| **Calendrier partagé** | Convenir d’un horaire | Disponibilités par utilisateur + « Trouver un créneau » entre fuseaux horaires |

Chacune de ces surfaces lit et écrit le *même* état de projet : une décision prise en réunion, un message dans la discussion et un ticket sur le tableau ne sont donc jamais isolés dans des outils séparés.

## 1. Un tableau partagé où humains et agents sont coéquipiers

Le socle est un tableau Kanban qui traite de la même façon une personne et un agent : tous deux sont des responsables de premier ordre. Faites glisser un ticket dans le couloir d’un agent et il s’exécute de façon autonome ; affectez-le à un collègue et il le prend en charge. Les couloirs peuvent exiger le bon relecteur avant qu’un ticket n’avance, et chaque « Terminé » comporte une validation auditée. Le tableau est l’endroit unique où vit le travail : la collaboration a donc toujours un sujet, un vrai ticket, pas un message Slack perdu.

## 2. Discussion d’équipe multi-participants — parlez à un humain *ou* à un agent

Les fils de discussion sont **globaux à leur projet et à leur tenant** : un coéquipier peut donc les voir, les ouvrir et les rejoindre pour collaborer. Invitez un collègue par e-mail, ou invitez un agent IA dans la salle. Adressez ensuite n’importe quel message à un participant précis :

- Adressez un message à un **humain** et il lui parle simplement : la boucle de l’agent reste inactive.
- Adressez un message à un **`@agent`** et cet agent répond réellement *en son nom propre*, en exécutant une boucle d’outils bornée et limitée par les permissions pour créer une tâche, mettre à jour un OKR ou lire le tableau, sans jamais dépasser votre propre accès.

![Un message dans le compositeur se divise en deux voies : adressé à un humain, il est remis de personne à personne et la boucle de l’agent reste inactive ; adressé à un @agent, il déclenche une boucle d’outils limitée par les permissions qui agit sur le tableau](/blog/collab-message-routing.svg)

C’est la différence entre un chatbot et une discussion de groupe où certains membres sont des IA.

## 3. Réunions vidéo en direct, points quotidiens et rétrospectives

Les équipes ne se contentent pas de co-éditer un tableau : elles peuvent **se voir et s’entendre**. Builderforce exécute de l’audio/vidéo en direct via un WebRTC maillé, de sorte que :

- Un responsable peut allumer les caméras de toute la table ronde pendant un point quotidien, une séance de planification ou une rétrospective.
- N’importe qui peut lancer un appel improvisé ou direct.
- Les médias circulent de pair à pair et ne touchent jamais le serveur.

La galerie de caméras se superpose directement à la table ronde des cérémonies : un point quotidien est ainsi une vraie réunion en face à face ancrée sur le même tableau que celui sur lequel tout le monde travaille.

## 4. Calendriers partagés et disponibilités réservables

Les réunions ont besoin d’un horaire que tout le monde peut tenir. Builderforce ajoute un **calendrier d’équipe** sur Main-d’œuvre et Portefeuille : une vue mensuelle ainsi qu’une grille hebdomadaire réservable qui superpose les réunions de l’application, les événements des calendriers Google/Microsoft connectés et les horaires de travail déclarés de chaque personne. Définissez une fois vos disponibilités hebdomadaires et votre fuseau horaire, et **« Trouver un créneau »** propose des créneaux où tous les invités sont réellement libres, dans leurs propres plages de travail, avec le bon fuseau horaire. Les réunions planifiées sont renvoyées sous forme d’invitations de calendrier aux participants.

## 5. La même collaboration, dans VS Code

Rien de tout cela n’exige de quitter votre éditeur. L’extension VS Code de BuilderForce amène la surface de collaboration dans la barre latérale : discutez avec les coéquipiers et les agents, voyez d’un coup d’œil quelles sessions sont **en cours d’exécution** ou **attendent votre réponse**, et une arborescence **Réunions** liste les appels à venir et en cours : rejoignez-les dans le navigateur ou exécutez l’appel WebRTC nativement dans une vue web de VS Code. Vous relisez, approuvez et vous réunissez sans rompre votre élan.

## Pourquoi c’est important

Les outils de collaboration supposent que chaque participant est un humain. Les outils d’agents supposent que chaque participant est une machine. Builderforce est conçu pour la réalité intermédiaire — une main-d’œuvre qui est **les deux** — et lui offre un endroit unique pour planifier, discuter, se réunir et livrer.

## Foire aux questions

**Puis-je avoir des humains et des agents IA dans le même fil de discussion ?** Oui. Les fils sont partagés au sein du projet ; invitez des personnes par e-mail et des agents dans la salle. Adressez un message à un humain pour lui parler, ou à un `@agent` pour que cet agent réponde et agisse en votre nom dans la limite de vos permissions.

**L’appel vidéo envoie-t-il mes médias à un serveur ?** Non. L’audio et la vidéo sont échangés de pair à pair via un WebRTC maillé ; le serveur ne relaie que la signalisation. STUN est fourni, avec TURN lorsqu’il est configuré.

**Puis-je rejoindre une réunion depuis VS Code ?** Oui. Une arborescence Réunions dans la barre latérale liste les réunions à venir et en cours ; « Rejoindre dans le navigateur » ouvre la réunion web authentifiée, et « Rejoindre ici » exécute l’appel nativement dans une vue web de VS Code.

**Ai-je besoin d’un outil de calendrier distinct ?** Non. Connectez Google Calendar ou Microsoft Graph et Builderforce superpose ces événements, grise vos disponibilités et renvoie les réunions planifiées sous forme d’invitations : la planification reste ainsi au même endroit.
