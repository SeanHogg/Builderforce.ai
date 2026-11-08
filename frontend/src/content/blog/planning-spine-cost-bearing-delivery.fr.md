# La colonne vertébrale de planification : une seule hiérarchie datée et porteuse de coûts, du portefeuille à la tâche

La stratégie vit dans une présentation. La livraison vit dans un tableau. Le coût vit dans un tableur financier. Trois outils, trois responsables, et un rituel mensuel où quelqu’un les rapproche à la main tandis que tout le monde se dispute pour savoir quel chiffre est le bon.

La **colonne vertébrale de planification** (Planning Spine) fusionne ces trois couches en une seule. C’est une hiérarchie unique et datée — **Portefeuille → Initiative → Épopée → Tâche**, avec des **Objectifs et résultats clés** qui se rattachent comme couche d’objectifs à n’importe quel niveau — où chaque nœud a une date de début, une date de fin et son propre coût consolidé. Vous planifiez, livrez et comptabilisez le même travail au même endroit.

> La colonne vertébrale de planification de Builderforce.ai est une hiérarchie unique, datée et porteuse de coûts — portefeuille, initiative, épopée et tâche sur un seul Gantt — où le coût des feuilles se cumule vers chaque ancêtre et se répartit en CAPEX et OPEX, de sorte que la finance et la livraison lisent la même source de vérité.

![Schéma de la colonne vertébrale de planification : une hiérarchie imbriquée portefeuille, initiative, épopée, tâche sur un seul Gantt où le coût des tâches feuilles se cumule vers chaque ancêtre, chaque nœud étant classé CAPEX ou OPEX par un résolveur à priorités, avec des indicateurs d’anomalie lorsqu’un enfant contredit son parent et un export CSV pour la clôture financière](/blog/planning-spine.svg)

## Le coût est une propriété du travail, pas un registre séparé

Comme chaque tâche sur Builderforce.ai est déjà instrumentée — les dépenses de LLM sont valorisées à l’écriture à partir du journal d’usage, l’effort humain à partir du taux de coût de chaque membre —, la colonne vertébrale de planification n’a pas besoin d’un système financier parallèle. Le coût des feuilles **se cumule** simplement vers chaque ancêtre : le coût d’une tâche remonte à son épopée, celui de l’épopée à son initiative, celui de l’initiative à son portefeuille. Vous obtenez un vrai chiffre à n’importe quelle altitude sans rattrapage.

Et chaque dollar est classé. Chaque nœud porte un `cost_class` **CAPEX** ou **OPEX**, résolu par ordre de priorité : une déclaration explicite l’emporte, sinon il est hérité du parent, sinon un classificateur d’agent en propose un à partir de la catégorie d’investissement du travail (l’innovation s’immobilise en CAPEX ; le maintien en conditions opérationnelles, le support et la dette technique se passent en charges OPEX), avec une valeur par défaut prudente selon les GAAP comme plancher. Lorsque la classe déclarée d’un enfant contredit celle de son parent, la colonne vertébrale la signale comme **anomalie** à réconcilier par un chef de projet : les décisions de capitalisation reçoivent une validation au lieu d’être héritées en silence.

## Un seul Gantt, à tous les niveaux

La colonne vertébrale de planification s’affiche sous la forme d’une seule chronologie imbriquée et repliable. Une barre de portefeuille contient ses initiatives ; une initiative contient ses épopées ; une épopée contient ses tâches — toutes datées, toutes sur le même axe, colorées selon la classe de coût avec des marqueurs d’anomalie là où la capitalisation demande une revue. Les **dépendances** au niveau des initiatives (bloquant → bloqué, sans cycle) pilotent un **chemin critique** à la demande : la plus longue chaîne inachevée est donc toujours visible.

Quand la finance a besoin des chiffres hors de l’application, toute la colonne vertébrale s’exporte en CSV pour n’importe quelle plage de dates : ce sont les mêmes chiffres que ceux du tableau de bord, prêts pour la clôture.

## Pourquoi c’est important

Une main-d’œuvre IA change du jour au lendemain le comportement des coûts. Quand ce sont des agents qui construisent, la dépense cesse de ressembler à des effectifs et commence à ressembler à de la consommation : par à-coups, par tâche, imputable. Un tableau qui suit l’état mais pas le coût ne peut pas répondre à la question que tous les directeurs financiers s’apprêtent à poser : *combien cette initiative a-t-elle réellement coûté, et quelle part pouvons-nous en capitaliser ?*

La colonne vertébrale de planification y répond à partir de données en direct. L’ingénierie y planifie, le PMO y consolide les portefeuilles et la finance y clôture les comptes : une hiérarchie, un seul jeu de chiffres, aucune étape de rapprochement.

[Visitez la plateforme →](/product) · [Voyez la vue d’ensemble opérationnelle de chaque rôle →](/blog/every-role-operating-picture) · [Commencez gratuitement →](/register)
