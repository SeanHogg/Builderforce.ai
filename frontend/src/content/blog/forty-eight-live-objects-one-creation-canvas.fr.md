# 48 objets vivants, un seul Creation Canvas extensible

Un espace de travail visuel devient fragile quand chaque carte est un composant sur mesure et que chaque intégration invente un nouveau comportement. Le Creation Canvas utilise à la place un contrat piloté par un registre : **48 types d’objets**, chacun avec un groupe connu, un moteur de rendu, un inspecteur, des actions, des champs modifiables, des connexions, un contexte sûr pour Brain et un adaptateur d’aperçu.

![Vue produit de la palette d’objets de création montrant dix groupes, des cartes d’objets vivants représentatives sur le canevas, des badges de capacités et les six types de connexion sémantique](/blog/creation-object-registry-workspace.svg)

## Dix groupes couvrent le travail sans l’aplatir

La palette organise les objets en Construire, Données, Connaissances, Analyses, Travail, Personnes, Agents, Modèles, Collaborer et Intégrations.

Construire comprend Flux de travail, Site web, Chat, Jeu de données, Prototype WYSIWYG, Code, Aperçu navigateur, artefacts de dépôt et d’éditeur, services locaux et Vidéo. Données comprend Tableau, Feuille de calcul, Graphique et Indicateur clé. Connaissances comprend Documents, Diapositives, fichiers, URL et éléments de connaissance. Analyses comprend Tableaux de bord, Rapports, Évaluations, comparaisons, Feuilles de route et Notes.

Travail, Personnes, Agents, Modèles et Collaborer contiennent les artefacts de planification, de main-d’œuvre, de modèles et de multijoueur qui entourent la livraison. Intégrations expose actuellement les outils MCP comme des objets natifs plutôt que comme une configuration de chat invisible.

## Chaque objet déclare ce que Brain peut faire

Le registre fournit les données par défaut, les actions natives et une liste d’autorisation des champs modifiables. Un site web peut être modifié, prévisualisé et publié. Un jeu de données peut être importé, profilé et visualisé. Un projet peut être développé et comparé. Un agent peut être inspecté, configuré et affecté. Evermind peut enseigner, s’entraîner, être évalué et être publié. Un objet MCP peut s’authentifier et s’exécuter.

Brain lit les mêmes déclarations que celles qui alimentent l’inspecteur. Il ne peut pas inventer un champ ou une action non pris en charge et faire accepter cela silencieusement par le canevas.

![Chacun des 48 types d’objets passe par un seul contrat de registre pour les données par défaut, le rendu, l’inspection, les actions natives, les champs modifiables, le contexte IA sûr, l’aperçu, la politique de capacités et six relations sémantiques autorisées : données, contrôle, référence, présentation, livraison et appartenance](/blog/creation-object-registry-contract.svg)

## Six liens transforment la mise en page en graphe

Le Creation Canvas définit six types de connexions sémantiques :

- **données** — un objet fournit des valeurs à un autre ;
- **contrôle** — un objet pilote ou configure un autre ;
- **référence** — un artefact en cite ou en dépend d’un autre ;
- **présentation** — un artefact en présente un autre ;
- **livraison** — un artefact approuvé avance vers l’exécution ;
- **appartenance** — une personne, un agent ou un élément appartient à un groupe ou à un rituel.

La proximité spatiale reste purement visuelle. Le sens vit dans le lien explicite.

## Les barrières de capacités préservent la politique du tenant

Certains types — Evermind, MCP, Agent, LLM, Voix et Vidéo — déclarent des capacités de la plateforme. La palette les filtre selon l’ensemble des capacités disponibles. Un modèle ne peut faire référence qu’à des types enregistrés, mais l’installer ne contourne jamais l’accès ni l’authentification du tenant.

## Un seul contrat indépendant du transport couvre toutes les surfaces

Les types d’objets, les types de connexions et les types de commandes versionnées résident dans un contrat partagé utilisé par le canevas web et la surface VS Code. Les deux peuvent donc parler de la même identité d’objet et de la même opération de graphe sans sérialiser une interface à l’intérieur de l’autre.

Le vocabulaire de commandes couvre le remplacement du graphe ; l’ajout, la mise à jour, le déplacement et la suppression d’objets ; l’ajout et la suppression de connexions ; et les changements de fenêtre d’affichage. Les révisions serveur fournissent la frontière d’ordonnancement et de conflit autour de ces commandes.

## L’extensibilité reste inspectable

Le registre est plus qu’une liste de palette. C’est l’endroit où un objet déclare ce qu’il est autorisé à exposer, accepter, prévisualiser et faire. Les nouveaux types d’objets sont ainsi composables dès le départ avec Brain, la collaboration, les modèles et les deux surfaces clientes.

Le canevas peut grandir sans devenir un tas de cartes non typées.

[Explorez la palette d’objets de création →](/create/new)
