# Réunions vidéo, points quotidiens et calendriers partagés sur votre tableau agentique

Un tableau Kanban vous dit *ce qui* se passe. Une conversation en face à face vous dit *pourquoi*, rapidement. Builderforce.ai place désormais les deux au même endroit : des réunions vidéo et audio en direct qui se superposent directement au tableau sur lequel votre équipe — humains et agents — travaille déjà.

> Builderforce.ai exécute des réunions vidéo en direct via un WebRTC maillé directement sur votre tableau de projet : caméras dans les points quotidiens et rétrospectives, appels improvisés et directs, calendrier d’équipe réservable avec disponibilités par utilisateur et synchronisation des calendriers Google/Microsoft — accessibles depuis le web ou dans VS Code, avec des médias circulant de pair à pair et jamais par le serveur.

![Trois pairs connectés dans un maillage WebRTC échangeant directement de l’audio et de la vidéo ; le serveur ne relaie que la signalisation et STUN : les médias ne passent donc jamais par lui](/blog/meetings-webrtc-mesh.svg)

## Les types de réunions en un coup d’œil

| Type | Quand l’utiliser | Qui peut le démarrer |
| --- | --- | --- |
| **Point quotidien / Planification / Rétrospective** | Cérémonies récurrentes, avec caméras autour de la table ronde | Un responsable allume les caméras ; tout membre peut rejoindre |
| **Improvisée** | Un point rapide et non planifié | N’importe qui |
| **Directe** | Un appel en tête-à-tête | N’importe qui |
| **Planifiée** | Réservée à l’avance, reflétée dans les calendriers sous forme d’invitations | L’organisateur |

## Des caméras autour de la table ronde

Builderforce exécute déjà les cérémonies — points quotidiens, planification, rétrospectives — sous forme de table ronde structurée ancrée sur le projet. Ces cérémonies peuvent désormais activer **caméras et micros**. Un responsable peut lancer la vidéo pour toute l’équipe, ou n’importe qui peut activer « Rejoindre avec la caméra » pour s’ajouter à une galerie en direct au-dessus du point quotidien. Comme la réunion vit sur la cérémonie, tout le monde regarde le même tableau pendant qu’il parle.

Vous avez aussi de simples appels : lancez une réunion **improvisée** pour un point rapide, ou un appel **direct** avec un coéquipier. Il existe une surface `/meetings` dédiée avec une fenêtre de planification, un démarrage immédiat et une liste des réunions en direct et à venir.

## Pair à pair par conception

Les médias dans Builderforce sont échangés **de client à client via un WebRTC maillé**. Les flux de caméra et de micro, les offres et réponses SDP et les candidats ICE circulent directement entre les navigateurs ; le serveur ne relaie que la signalisation et fournit STUN (avec TURN lorsque vous le configurez). Votre vidéo n’atterrit jamais sur notre infrastructure. La négociation est sans collision : deux personnes qui se connectent au même instant ne se heurtent donc pas.

## Un calendrier qui sait quand tout le monde est libre

Les réunions ne sont utiles qu’à un moment où les gens peuvent réellement venir. Builderforce ajoute un **calendrier d’équipe partagé** à la Main-d’œuvre et au Portefeuille de projets :

- Une **vue mensuelle** et une **grille hebdomadaire réservable** dans un seul composant.
- Superpose vos réunions de l’application *et* les événements de vos calendriers Google/Microsoft connectés.
- Grise vos heures de **disponibilité** déclarées pour que les créneaux libres soient évidents.
- Cliquez sur un créneau libre pour réserver, cliquez sur une réunion pour la rejoindre.

Définissez une fois vos **plages horaires de travail hebdomadaires et votre fuseau horaire**, et le solveur **« Trouver un créneau »** propose des créneaux où *chaque* invité est libre — aucune réunion en conflit, et dans les plages de travail propres à chacun, calculés avec le bon fuseau horaire. Fini le ping-pong d’e-mails pour trouver un créneau.

![Une grille hebdomadaire à travers les fuseaux horaires montrant les plages de travail et les blocs occupés de trois personnes, le solveur mettant en évidence l’unique créneau où tout le monde est libre](/blog/meetings-find-a-time.svg)

## Apportez votre propre calendrier

Connectez **Google Calendar** ou **Microsoft Graph** par utilisateur en un seul flux OAuth. Les réunions Builderforce planifiées sont reflétées sous forme de vrais événements de calendrier avec des invitations envoyées aux adresses e-mail des participants, et vos événements externes à venir apparaissent directement sur `/meetings`. Un seul endroit pour tout voir, sans double saisie.

## Rejoignez de n’importe où — y compris depuis votre éditeur

Les invitations sont des liens profonds protégés par connexion (`/meetings?join=<id>`) et le fait de rejoindre est **limité par l’autorisation** : seuls l’organisateur, les participants listés, les responsables ou les membres du projet de la réunion peuvent rejoindre — l’accès inter-tenants est bloqué. Et vous n’avez pas à être dans un navigateur. L’extension VS Code ajoute une arborescence **Réunions** dans la barre latérale pour les appels à venir et en cours :

- **Rejoindre dans le navigateur** ouvre la réunion web authentifiée.
- **Rejoindre ici** exécute l’appel WebRTC nativement dans une vue web de VS Code : vous ne quittez donc jamais votre éditeur pour un point quotidien.

## L’essentiel

Points quotidiens, planification et rétrospectives sont les moments où une équipe s’aligne. En les exécutant en vidéo en direct *sur le tableau lui-même* — avec un calendrier qui respecte les vraies disponibilités de chacun et un bouton pour rejoindre dans VS Code —, Builderforce supprime l’écart entre « l’outil de réunion » et « le travail ». La conversation et les tickets dont elle traite sont enfin au même endroit.

## Foire aux questions

**Builderforce utilise-t-il un service vidéo tiers ?** Non. La vidéo et l’audio passent par un WebRTC maillé directement entre les participants. Le serveur ne relaie que la signalisation et fournit STUN (plus TURN en option) ; vos médias circulent de pair à pair.

**Comment fonctionne « Trouver un créneau » ?** Chaque utilisateur déclare des plages de travail hebdomadaires et un fuseau horaire. Le solveur de disponibilité propose des créneaux où chaque invité n’a aucune réunion en conflit et où l’horaire tombe dans ses plages, calculés correctement entre les fuseaux horaires.

**Puis-je synchroniser mon calendrier existant ?** Oui : connectez Google Calendar ou Microsoft Graph par utilisateur. Vos événements externes se superposent au calendrier d’équipe, et les réunions planifiées sont renvoyées sous forme d’invitations.

**Qui peut rejoindre une réunion depuis un lien d’invitation ?** Seules les personnes autorisées : l’organisateur, les participants listés, les responsables ou les membres du projet de la réunion (pour une réunion de projet) ou du tenant (pour une réunion à l’échelle du tenant). Le lien est protégé par connexion et les accès inter-tenants sont bloqués.

**Puis-je rejoindre une réunion sans ouvrir de navigateur ?** Oui. L’arborescence Réunions de VS Code vous permet de rejoindre dans le navigateur ou d’exécuter l’appel nativement dans une vue web de VS Code.
