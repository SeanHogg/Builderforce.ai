# Migrer sans crainte : Jira, Monday, Rally, GitLab, Bitbucket et GitHub vers BuilderForce

La principale raison pour laquelle les équipes restent sur un outil qu’elles ont dépassé, c’est la migration elle-même. Des années de tickets, une taxonomie de projets que tout le monde connaît par cœur, des responsables, des sprints, des points d’effort : ce que l’on craint n’est pas le nouvel outil, c’est de perdre l’historique de l’ancien dans la bascule. BuilderForce traite donc la migration comme un flux de travail de premier ordre, réversible jusqu’à ce que vous vous engagiez, et non comme un bouton d’import à usage unique sur lequel on croise les doigts.

![Schéma en entonnoir : les fournisseurs avec badge de migration Jira, monday, Rally, GitLab, Bitbucket et GitHub, ainsi que des sources en synchronisation seule, alimentent un assistant de migration progressif en sept étapes qui produit un tableau BuilderForce et une connexion de synchronisation en direct](/blog/migrate-integrate.svg)

## Deux façons d’adopter : migrer, synchroniser, ou les deux

Toutes les équipes ne veulent pas partir. Certaines veulent tout déplacer ; d’autres ne veulent jamais quitter Jira et veulent simplement que les données circulent vers BuilderForce pour que leurs agents et leurs tableaux de bord puissent agir dessus. Chaque intégration prend en charge les deux, au choix pour chaque exécution :

- **Migrer** — un import ponctuel de vos éléments historiques en tâches BuilderForce.
- **Synchroniser** — une connexion continue qui interroge en permanence, de sorte que les changements arrivent sans interruption. Vous ne quittez jamais votre outil de suivi.
- **Les deux** — importer l’historique *et* mettre en place la connexion en direct.

## Tout ce que nous connectons

La galerie d’intégrations (sous **Paramètres → Intégrations**) est la maison de l’espace de travail pour chaque système externe. Chaque fournisseur est une carte que vous connectez, configurez et surveillez, avec des identifiants, des connexions en direct et un onglet d’activité et de diagnostic qui montre chaque exécution de synchronisation.

**Travail et gestion de projet :** Jira, monday.com, Rally (CA Agile Central), Linear, Asana, ClickUp.

**Gestion de code source et tickets :** GitHub, GitLab, Bitbucket — *à la fois* leurs gestionnaires de tickets (migrés comme n’importe quel tableau) **et** leurs dépôts (connectés pour le code, les branches et les pull requests).

**Gestion des services informatiques :** ServiceNow, Freshservice — les incidents et les tickets alimentent la perspective Qualité.

**Supervision et astreinte :** Sentry, PagerDuty — alertes et incidents deviennent du travail exploitable.

Les fournisseurs qui prennent en charge l’assistant de migration portent un badge **Migration** : Jira, monday, Rally, GitLab, Bitbucket et GitHub aujourd’hui. Les autres se connectent pour une synchronisation continue.

## L’assistant de migration : préparer avant d’atterrir

Rien ne touche vos vrais projets, tâches ou membres tant que vous n’avez pas appuyé sur importer. Tout ce qui précède vit dans un tampon de préparation que vous pouvez relire, ajuster et abandonner :

1. **Connecter** — choisissez l’identifiant et le mode (migrer / synchroniser / les deux).
2. **Découvrir** — BuilderForce lit le système externe et prépare ses projets, types d’éléments et utilisateurs. Aucune écriture pour l’instant.
3. **Associer et combiner les projets** — affectez chaque projet externe à un nouveau projet BuilderForce, ou associez-en plusieurs à *un seul* projet pour les combiner. Le problème classique du « nous avons cinq projets Jira qui sont en réalité un seul produit » se résume à cinq lignes pointant vers la même cible.
4. **Associer les types d’éléments** — transformez `Story`, `Bug`, `Epic`, `Defect`, `incident` en le bon type de tâche BuilderForce et le bon statut de départ. Cette association est aussi enregistrée pour la synchronisation continue : les tâches synchronisées atterrissent dans le bon couloir plutôt que dans un backlog générique.
5. **Associer les utilisateurs** — invitez les responsables externes que vous voulez, ou associez-les à des membres existants. Les éléments importés conservent leur responsable lorsque la personne est associée à un membre.
6. **Relire** — voyez les éléments préparés, décochez ce que vous voulez laisser de côté.
7. **Importer** — les projets sont créés (ou combinés), les tâches sont importées avec leur type, leur statut, leurs points d’effort et leur responsable, les utilisateurs sont invités et, si vous avez choisi la synchronisation, des connexions en direct sont créées pour que le tableau se maintienne à jour tout seul.

Comme les éléments importés sont reliés à leur source, la première synchronisation après une migration est une opération nulle propre, et non une tempête de doublons.

## Laissez Brain s’en charger

Tout le flux est disponible pour Brain sous forme d’outils. Vous pouvez simplement dire :

> « Connecte Bitbucket — voici le jeton d’accès et l’espace de travail. Teste-le, puis lance une migration. »

Brain stocke l’identifiant (chiffré), valide la connexion, lance l’exécution et ouvre le panneau de migration à **gauche** de votre écran, là où il peut travailler aux côtés de Brain, qui vit à droite. Vous associez, relisez et importez ; il gère la tuyauterie. Connecter, valider, rapprocher, importer, sous forme de conversation.

## Pourquoi c’est important

La crainte de la migration est une taxe sur toutes les bonnes décisions qu’une équipe pourrait prendre. En préparant tout, en vous laissant combiner et réassocier à l’entrée, en préservant les personnes et l’historique, et en proposant « synchroniser sans déplacer » comme option de premier ordre, BuilderForce supprime cette taxe. Vous évaluez sur vos données réelles, dans votre structure réelle, sans rien détruire, et vous pouvez changer d’avis jusqu’au moment où vous vous engagez.
