# Des lignes brutes à un récit de données vivant sur un seul canevas

L’analyse se fragmente souvent au moment même où elle devient utile. Les données vivent dans un tableur, le graphique dans un carnet, la décision dans un document et la version pour la direction dans des diapositives. Chaque copie affaiblit le lien avec les preuves.

Le Creation Canvas traite le récit de données complet comme un ensemble connecté d’objets vivants.

![Vue produit d’un canevas de récit de données vivant, avec un tableau source Dataset relié à un graphique et à un indicateur clé, assemblés dans un tableau de bord et un rapport, et présentés dans des diapositives avec des liens visibles de données, de référence et de présentation](/blog/live-data-stories-workspace.svg)

## Commencez par des preuves, pas par une capture d’écran

Un objet Dataset peut importer du contenu CSV ou TSV dans des champs structurés bornés. Le canevas enregistre les colonnes, le nombre de lignes et un échantillon sûr pour l’inspection et le contexte de Brain, plutôt que d’injecter un tableau illimité dans chaque requête de raisonnement.

Profilez le jeu de données pour comprendre sa forme et sa couverture. Visualisez-le pour créer un graphique relié à la source. Pour l’analyse manuelle, les objets Tableau et Feuille de calcul contiennent des lignes, des colonnes et des formules structurées. Ce sont des artefacts différents, aux finalités différentes, et non une « carte de données » générique.

## Construisez la couche de décision

Les objets Graphique contiennent le type de graphique, les libellés, les valeurs et les sources. Les objets Indicateur clé portent la valeur, la cible, l’unité, la tendance et les références de source. Un tableau de bord peut assembler des indicateurs et des graphiques en une vue opérationnelle ; l’actualisation et l’exploration restent des actions natives de l’objet.

Les rapports et les évaluations ajoutent l’interprétation. Un rapport peut combiner du Markdown, des données de graphique et des citations. Une évaluation consigne un verdict, des lacunes, des recommandations et des sources. Brain peut travailler sur l’ensemble des preuves et des objets analytiques sélectionnés sans confondre leur position visuelle avec une dépendance de données.

![Les objets Dataset, Tableau et Feuille de calcul forment la couche de preuves ; les objets Graphique et Indicateur clé forment la couche visuelle ; Tableau de bord, Rapport et Évaluation forment la couche de décision ; les diapositives présentent le récit tandis que des connexions typées de données, de référence et de présentation préservent la provenance](/blog/data-story-object-pipeline.svg)

## Les relations portent du sens

Une ligne sur le canevas n’est pas qu’un décor. Utilisez une connexion de **données** quand un objet fournit des valeurs, une connexion de **référence** quand une conclusion cite des preuves, et une connexion de **présentation** quand un tableau de bord ou un rapport alimente des diapositives.

Ce graphe sémantique permet à Brain de distinguer « ce graphique utilise le jeu de données » de « cette diapositive mentionne le rapport ». Il rend aussi le récit visuel relisible par quelqu’un qui ne l’a pas construit.

## Partez d’un pack complet

Le modèle livré **Récit de données** place sur le canevas un jeu de données source, un graphique de tendance clé, un tableau de bord de décision et un objet Diapositives de récit de données pour la direction, avec des relations de départ utiles. C’est un échafaudage, pas un flux de travail scellé. Ajoutez une feuille de calcul pour les calculs, des indicateurs clés pour les cibles, une évaluation pour les lacunes, ou le contexte d’un projet pour la performance de livraison.

## Gardez la sortie destinée à la direction connectée

Quand le récit change, les preuves doivent rester inspectables. Un objet Diapositives sur le canevas peut conserver ses sources au lieu de devenir la copie finale d’une présentation déconnectée. Les relecteurs peuvent remonter d’une affirmation au rapport, au tableau de bord, au graphique et enfin au jeu de données qui l’étaye.

C’est la différence entre décorer une conclusion avec des graphiques et construire un récit de données digne de confiance :

**lignes → profil → preuves visuelles → vue de décision → interprétation écrite → présentation**

Chaque étape reste un objet. Chaque dépendance importante peut rester un lien typé.

[Construisez un récit de données →](/create/new)
