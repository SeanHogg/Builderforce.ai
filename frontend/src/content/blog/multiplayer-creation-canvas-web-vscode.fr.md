# Une seule session de création multijoueur, sur le web et dans VS Code

Le travail transverse se brise généralement en fragments à la forme des outils. Le contexte produit vit dans un ticket. Les preuves clients vivent dans un tableau de bord. Le prototype vit dans un outil de design. Le contexte d’implémentation vit dans VS Code. La conversation sur les quatre vit ailleurs.

Les sessions de création de Builderforce donnent à ces artefacts un foyer spatial partagé sans forcer chaque collaborateur à utiliser le même éditeur.

![Une session de création partagée haute fidélité reliant un canevas visuel de navigateur et un éditeur de code natif par un prototype unique, des objets partagés, des commentaires, des curseurs, de la présence et du contexte d’implémentation](/blog/multiplayer-canvas-hero.webp)

## Une session serveur, deux surfaces natives

Sur le web, le Creation Canvas est l’espace de travail visuel par défaut pour le chat, les flux de travail, les sites web, les données, les modèles, les personnes, les agents et les projets facultatifs. Dans l’extension VS Code de BuilderForce, la même session s’ouvre dans un onglet d’éditeur complet : ni un iframe ni une étroite barre latérale.

Les deux surfaces utilisent le même graphe de session, les mêmes identités d’objets, les mêmes permissions, le même contrat de commandes versionnées, la même présence et les mêmes commentaires. La chronologie d’activité complète et les inspecteurs spécialisés restent disponibles dans le navigateur. Un utilisateur du web et un utilisateur de l’éditeur sont des collaborateurs d’une même session, et non des utilisateurs de copies synchronisées.

La surface native VS Code peut ajouter du contexte de développement sans quitter l’éditeur :

- fichiers ou sélections en cours ;
- contexte de dépôt et de branche ;
- diagnostics et Problèmes ;
- sortie de terminal collée, avec un avertissement sur les secrets ;
- services locaux et aperçus de navigateur ;
- tout type d’objet Canvas partagé issu de la palette native.

Un chef de produit peut relier des preuves clients et une maquette sur le web pendant qu’un développeur relie le diagnostic en échec, la sélection de source pertinente et l’aperçu local depuis VS Code.

![Le Creation Canvas web apporte les preuves clients, les prototypes, les perspectives de projet, l’activité et les inspecteurs, tandis que l’onglet natif VS Code apporte les fichiers, le contexte de dépôt, les diagnostics, la sortie de terminal, les services locaux et les aperçus ; les deux utilisent un seul graphe de session avec des identités d’objets, des permissions, une présence, des commentaires, une activité et des commandes versionnées partagés](/blog/multiplayer-canvas-shared-session.svg)

## Collaborer sans bataille de fenêtres d’affichage

Chaque membre a sa fenêtre d’affichage personnelle. Déplacer ou zoomer votre canevas ne déplace jamais celui de quelqu’un d’autre. Dans le navigateur, la présence affiche les curseurs, les sélections, l’état de saisie et la surface cliente utilisée. Le panneau VS Code signale sa sélection actuelle via le même contrat de présence durable.

Lorsque quelqu’un présente, les collaborateurs peuvent délibérément suivre la fenêtre d’affichage de cette personne. Quitter le mode suivi rend le contrôle à chacun. Cela rend les présentations commentées utiles sans transformer la collaboration ordinaire en partage d’écran à distance.

Les commentaires se rattachent aux objets. Les mentions et l’activité identifient qui a demandé à Brain d’agir, qui a relu une proposition et quelle ressource canonique a changé. Les rôles distinguent les accès Lecteur, Commentateur, Éditeur, Exécutant et Propriétaire. Les permissions des ressources sous-jacentes continuent de s’appliquer : l’invitation à une session n’est pas un raccourci vers un projet, un jeu de données, un agent ou un dépôt auquel le membre n’a pas accès.

## Une passation pratique de la conception au code

Imaginez une équipe qui relit un nouveau parcours d’intégration :

1. Le produit ajoute un objet Projet et développe les perspectives retours clients et livraison.
2. Le design place un prototype WYSIWYG et sa variante mobile à côté des preuves.
3. Brain évalue le prototype par rapport aux fonctionnalités demandées et crée un ensemble de modifications relisible.
4. L’équipe approuve une maquette et la livre dans une tâche de projet affectée à un agent d’implémentation.
5. Un développeur ouvre la même session dans VS Code et ajoute le dépôt pertinent, la sélection de composant, les diagnostics et l’aperçu local.
6. L’agent s’exécute selon la politique d’approbation du projet. Le statut de compilation et la sortie réapparaissent dans la session.

Personne n’a à reconstituer pourquoi la tâche existe. Les preuves, la décision, l’artefact, le contexte d’implémentation et l’historique d’exécution restent connectés.

## Explorer en toute sécurité avec des branches et des points de contrôle

Les points de contrôle nommés préservent les états de revue significatifs. Une branche de session prend en charge une expérience plus indépendante — par exemple une autre architecture de l’information ou un autre pipeline de modèle. Quand la branche revient, Builderforce présente une relecture de fusion explicite, objet par objet. Le relecteur peut utiliser la version de la branche ou conserver la version du parent pour chaque objet correspondant.

Les dessins à main levée, les notes et les cadres réutilisables soutiennent le travail spatial désordonné qui entoure les artefacts formels. Les packs de la place de marché fournissent des points de départ plus structurés pour les campagnes, la découverte produit, les récits de données, les points quotidiens, les constructions de modèles et les revues exécutives.

## La passation devient une vue d’ensemble opérationnelle partagée

« Passation » suppose qu’une équipe termine et qu’une autre commence. Une session de création multijoueur permet un meilleur modèle : les contributeurs ajoutent le contexte propre à leur travail, tandis que le canevas partagé préserve les relations et que Brain aide à raisonner à travers elles.

Le navigateur reste l’endroit le plus accessible pour rassembler le contexte métier. VS Code reste l’endroit adapté à l’implémentation détaillée. Builderforce les relie sans réduire ni l’un ni l’autre à une transcription.

[Démarrez une session de création partagée →](/create/new)
