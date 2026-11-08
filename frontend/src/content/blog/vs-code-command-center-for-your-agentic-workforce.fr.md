# Le centre de commande VS Code : pilotez toute votre main-d’œuvre agentique sans quitter l’éditeur

Les développeurs vivent dans leur éditeur. Au lieu de vous demander de le quitter, Builderforce.ai amène toute la plateforme *dans* VS Code. L’extension n’est plus seulement un panneau de discussion : c’est un **centre de commande** pour piloter une main-d’œuvre mixte d’humains et d’agents IA, avec collaboration, réunions, état en direct et entraînement de modèles, le tout dans la barre latérale.

> L’extension VS Code BuilderForce exécute toute la plateforme dans votre éditeur : discussion d’équipe multi-participants, état des sessions en direct, réunions vidéo natives, console d’entraînement Evermind, arborescences de projets et de tâches, et approbations avec l’humain dans la boucle : vous gérez toute une main-d’œuvre agentique sans quitter VS Code.

![La barre latérale VS Code de BuilderForce montrant ses surfaces — discussion d’équipe Sessions, Projet et tâches avec état en direct, Réunions, Evermind, approbations de la Boîte de réception et Analyses — à côté d’un volet d’éditeur listant les garanties de gouvernance](/blog/vscode-command-center.svg)

Voici ce que chaque surface de la barre latérale vous apporte.

| Surface de la barre latérale | Ce qu’elle fait |
| --- | --- |
| **Sessions** | Discussion d’équipe multi-participants — humains + `@agents`, messages dirigés, avatars |
| **Projet et tâches** | Votre tableau et le travail qui vous est affecté, avec une surcouche d’état en direct par ligne |
| **Réunions** | Appels à venir et en cours — rejoindre dans le navigateur ou nativement dans une vue web |
| **Evermind** | Inspecter et entraîner le modèle auto-actualisé de votre projet |
| **Boîte de réception** | Approbations et décisions avec l’humain dans la boucle |
| **Analyses et diagnostics** | La vue d’ensemble opérationnelle et des analyses en un clic |

## Voyez ce qui a besoin de vous — d’un coup d’œil

Quand vous faites tourner plusieurs agents à la fois, la question la plus difficile est « lequel a besoin de moi maintenant ? ». Un seul signal côté serveur y répond sur chaque surface. Dans VS Code, les arborescences **Sessions** et **Projet et tâches** superposent une icône d’état en direct sur chaque ligne :

- **En cours d’exécution** — un indicateur bleu qui tourne : l’agent travaille activement (et il continue de travailler même quand vous changez de discussion).
- **A besoin de votre réponse** — un marqueur ambre avec un `❓` : l’exécution s’est arrêtée sur une question et vous attend.
- **Terminé** — une coche verte.

![Trois lignes d’état en direct — un indicateur bleu qui tourne pour en cours d’exécution, un point d’interrogation ambre pour a besoin de votre réponse, et une coche verte pour terminé — le signal unique qui suit une session sur toutes les surfaces](/blog/vscode-live-status.svg)

L’état suit une session partout où elle est affichée : le multitâche sur des exécutions concurrentes se lit donc instantanément.

## Discussion d’équipe multi-participants dans la barre latérale

Le panneau Sessions est une vraie discussion d’équipe, et non une zone de prompt en solo. Les fils sont partagés au sein de votre projet, vous pouvez inviter des humains et des agents IA dans une salle, et vous adressez chaque message à un participant précis : parlez à un coéquipier, ou mentionnez un agent avec `@` pour qu’il réponde et agisse sur le tableau dans la limite de vos permissions. Les participants s’affichent sous forme d’avatars colorés directement dans l’arborescence : vous voyez qui est dans chaque salle.

## Rejoignez les réunions nativement

Une arborescence **Réunions** liste vos appels à venir et en cours. **Rejoindre dans le navigateur** ouvre la réunion web authentifiée ; **Rejoindre ici** exécute l’appel vidéo WebRTC maillé *nativement dans une vue web de VS Code*. Points quotidiens, planification et rétrospectives se déroulent sans jamais quitter votre code des yeux.

## Inspectez et entraînez Evermind

Chaque projet possède son propre **Evermind**, un modèle auto-actualisé qui apprend du travail de votre équipe. C’est désormais une vue de premier ordre de la barre latérale. Ouvrez la console Evermind pour voir ce qu’il a appris (version, nombres appris/en file, date du dernier apprentissage), orienter son entraînement (partir d’un modèle publié, connecter ou geler l’apprentissage, choisir un modèle enseignant), **lui enseigner à partir d’une transcription** en collant un exemple, et vider la file d’apprentissage à la demande. Les responsables disposent des commandes ; tout le monde peut inspecter. La même console s’affiche sur le web : un seul composant, deux hôtes.

## Les arborescences qui font tourner le travail

L’extension porte aussi le reste de la plateforme :

- **Projet et tâches** — votre tableau et le travail qui vous est affecté, avec la même surcouche d’état en direct.
- **Boîte de réception** — approbations et éléments qui nécessitent une décision.
- **Analyses** et **Diagnostics** — la vue d’ensemble opérationnelle et les analyses.
- **Exécuter et relire** — envoyez des tâches à des agents, relisez et validez leur production, et approuvez les actions avec l’humain dans la boucle là où vous codez.

## Gouverné, et à vous

Les chemins d’exécution VS Code pris en charge utilisent les approbations configurées de la plateforme et les enregistrements d’exécution disponibles. La disponibilité des modèles et la facturation dépendent du catalogue actuel, des identifiants, du forfait et de l’environnement d’exécution ; la parité entre le web et l’extension est documentée par capacité.

## Pourquoi c’est important

Le changement de contexte est la taxe de la gestion d’agents. Chaque fois que vous quittez l’éditeur pour vérifier une exécution, répondre à une question, rejoindre un point quotidien ou régler un modèle, vous perdez le fil. Le centre de commande VS Code supprime cette taxe : toute la main-d’œuvre — ses discussions, ses réunions, son état et son modèle d’apprentissage — vit à un panneau de votre code.

## Foire aux questions

**Puis-je savoir quel agent a besoin de moi sans ouvrir chacun d’eux ?** Oui. Les arborescences Sessions et Projet et tâches superposent un état en direct par ligne — indicateur bleu qui tourne pour en cours d’exécution, `❓` ambre pour en attente de votre réponse, coche verte pour terminé — à partir d’un seul signal côté serveur.

**La discussion VS Code est-elle juste moi et un modèle ?** Non. Elle est multi-participants : les fils sont partagés au sein de votre projet, vous pouvez inviter des humains et des agents, et vous adressez les messages à des participants précis — y compris des mentions `@agent` qui font répondre un agent et agir dans la limite de vos permissions.

**Puis-je rejoindre des réunions vidéo dans VS Code ?** Oui. L’arborescence Réunions vous permet de rejoindre dans le navigateur ou d’exécuter l’appel WebRTC nativement dans une vue web de VS Code.

**Puis-je entraîner le modèle de mon projet depuis l’éditeur ?** Oui. La vue Evermind de la barre latérale permet aux responsables d’inspecter ce que le modèle a appris, d’orienter l’entraînement, de lui enseigner à partir d’une transcription collée et de vider la file d’apprentissage — la même console que celle qui apparaît sur le web.

**Les actions d’agents dans VS Code contournent-elles la gouvernance ?** Les chemins d’exécution pris en charge utilisent la politique de plateforme configurée pour eux. Vérifiez la matrice des capacités pour l’action que vous comptez exécuter, car la couverture entre le web et l’extension n’est pas universelle.
