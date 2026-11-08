# Concevoir, construire et déboguer dans un seul espace de travail spatial

La partie la plus coûteuse du passage de la conception au code n’est souvent pas l’implémentation. C’est la reconstitution du contexte : quel concept a été approuvé, quel composant l’implémente, quel diagnostic compte, et si l’aperçu local reflète la branche actuelle.

Le Creation Canvas peut contenir cette chaîne sous forme d’artefacts connectés, au lieu d’une traînée de liens répartie entre des outils.

![Vue produit d’une session de la conception au débogage, avec des artefacts WYSIWYG de site web et de mobile reliés à des objets Dépôt, Sélection de l’éditeur, Diagnostics, Sortie de terminal, Service local et Aperçu navigateur](/blog/design-build-debug-workspace.svg)

## Les artefacts de conception restent modifiables

Un objet Site web représente le concept d’un site multi-pages avec titre, corps, appel à l’action, accent, fenêtre d’affichage et pages. Un prototype WYSIWYG fournit un concept interactif pour un travail produit plus ciblé. Les objets Maquette et Ensemble de maquettes prennent en charge des concepts de fonctionnalités relisibles individuellement et leur livraison.

Ces objets peuvent être révisés directement ou rédigés par Brain via leurs champs modifiables déclarés. L’aperçu reste une action native de l’objet plutôt qu’une capture d’écran collée dans la conversation.

## Le contexte de développement arrive depuis VS Code

La surface native BuilderForce de VS Code peut ajouter un dépôt, la sélection actuelle de l’éditeur, des diagnostics, la sortie du terminal, un service local, un espace de travail de code et un aperçu de navigateur à la même session adossée au serveur.

Chaque objet porte le contexte adapté à son type : URL et branche du dépôt ; code sélectionné, langage, chemin et plage ; éléments de diagnostic et gravité ; contenu du terminal et code de sortie ; ou URL et port d’un service local. Les artefacts de terminal sont explicitement signalés pour une revue des secrets, et les clés de contexte sensibles sont exclues de l’adaptateur d’objet sûr de Brain.

![Site web, prototype WYSIWYG et maquette forment la couche de conception ; dépôt, sélection et code forment le contexte d’implémentation ; diagnostics et terminal fournissent les preuves de défaillance ; le service local alimente l’aperçu navigateur ; le résultat approuvé peut devenir une tâche de projet gouvernée](/blog/design-to-debug-object-graph.svg)

## Reliez la défaillance à ce qu’elle affecte

Les relations typées rendent un canevas de débogage utile. Une sélection peut **référencer** un prototype. Les diagnostics peuvent **référencer** la sélection. Un service local peut **contrôler** un aperçu de navigateur. L’aperçu peut **présenter** le site web actuel. Une maquette approuvée peut être reliée par **livraison** à une tâche.

Brain peut alors répondre à une question délimitée comme « Cette implémentation répond-elle au concept mobile sélectionné, et qu’est-ce qui bloque l’aperçu ? » en s’appuyant sur les objets concernés plutôt que sur tout le dépôt ou une transcription aplatie.

## Relisez avant de modifier l’espace de travail

Si Brain propose un artefact de code, met à jour un critère d’acceptation, réorganise le cadre ou ajoute une relation, ces modifications apparaissent sous forme d’ensemble de propositions. Les actions opérationnelles natives conservent leurs propres permissions. Un canevas local anonyme peut esquisser l’image complète de l’implémentation, mais la livraison durable et l’affectation attendent un espace de travail adossé à un compte.

## Une seule passation, toujours une seule session

Le produit et le design peuvent contribuer depuis le navigateur. L’ingénierie peut contribuer depuis l’éditeur. Aucune des deux surfaces n’est réduite à une vue intégrée de l’autre. Le graphe d’objets partagé devient le contrat de passation :

**intention approuvée → contexte d’implémentation → preuves de diagnostic → service en marche → résultat dans le navigateur → livraison gouvernée**

Quand l’artefact, le code et la défaillance vivent ensemble, « qu’essayions-nous de construire ? » cesse d’être une tâche de débogage récurrente.

[Démarrez une session de la conception au code →](/create/new)
