# Le système de référence du travail agentique

Depuis trente ans, la pile logicielle d’entreprise est un problème de rapprochement. Le tableau vit dans un outil, le code dans un autre, les déploiements dans un troisième, les dépenses dans un quatrième, et la réponse à une question simple — *combien cette initiative a-t-elle coûté, et a-t-elle fonctionné ?* — vit dans un tableur que quelqu’un reconstruit chaque trimestre. La raison est structurelle : les humains n’ont jamais été instrumentés. On voyait le commit, mais pas le coût ; le ticket, mais pas les reprises ; le déploiement, mais pas la décision qui le sous-tendait.

L’ère agentique brise cette contrainte, et la plupart des équipes ne l’ont pas encore remarqué.

![Schéma du système de référence du travail agentique : un pipeline idée, construction, livraison, apprentissage où l’étape d’apprentissage réinjecte le routage dans l’exécution suivante, avec un coût valorisé à l’écriture et cumulé du ticket au projet, à l’initiative puis au tenant, et des humains et des agents partageant un même tableau instrumenté](/blog/system-of-record.svg)

## La moitié de votre main-d’œuvre est désormais entièrement instrumentée

Quand un agent IA accomplit une unité de travail, il émet un enregistrement parfait par construction. Chaque outil appelé, chaque jeton dépensé, chaque modèle choisi, chaque étape franchie, que la compilation ait réussi, que la pull request ait été fusionnée : tout est capturé parce que l’environnement d’exécution *est* le travailleur. Il n’y a aucun écart entre le travail et la trace du travail.

Builderforce.ai est construit autour de ce fait. Chaque exécution d’agent écrit une trace chiffrée et attribuée. Chaque appel de LLM est valorisé à l’écriture et cumulé ticket → projet → initiative → tenant. Chaque déploiement émet les primitives DORA : fréquence, taux d’échec des changements, délai de rétablissement. Chaque transition de tâche est horodatée. Et comme humains et agents partagent un seul tableau, la même instrumentation est reproduite sur les personnes : débit, délai de cycle, reprises, engagement.

Le résultat n’est pas « davantage de tableaux de bord ». C’est un autre type d’objet : **un système de référence où chaque unité de travail — humaine ou agentique — est capturée, chiffrée et attribuée tout au long de son cycle de vie.**

## Idée → livraison → apprentissage, sur un seul substrat

Un système de référence ne vaut que par sa couverture. Builderforce.ai instrumente l’arc complet :

- **Idée.** Le brainstorming et les spécifications sont de premier ordre : une initiative a donc un début que l’on peut désigner, et non un fil Slack dont quelqu’un se souvient vaguement.
- **Construction.** Les tâches circulent sur un tableau Kanban travaillé aussi bien par des humains que par des agents, chaque transition étant consignée.
- **Livraison.** Les pull requests ouvertes par les agents portent l’état de la compilation et de la fusion ; les déploiements émettent un signal DORA.
- **Apprentissage.** Chaque exécution terminée est notée selon qu’elle a réellement été livrée — la PR a-t-elle été fusionnée, la CI a-t-elle réussi, combien d’étapes et de dollars cela a-t-il demandé — et ce résultat alimente la manière dont l’exécution suivante est routée.

Comme les données sont collectées une fois et attribuées, vous ne rapprochez jamais rien. Le coût d’une initiative est un cumul, pas un projet de recherche. L’efficacité d’une approche est une requête, pas une opinion.

## Pourquoi c’est le coin d’entrée en entreprise — sans tarifs d’entreprise

Les plateformes « d’entreprise » traditionnelles font payer l’intégration : elles vous vendent les coutures entre les six outils que vous possédez déjà. Un système de référence supprime les coutures. Vous n’avez pas besoin d’un éditeur d’observabilité pour vous dire ce que vos agents ont fait : l’environnement d’exécution l’a déjà consigné. Vous n’avez pas besoin d’un outil FinOps distinct pour attribuer les dépenses : le coût a été estampillé au moment de l’appel. Vous n’avez pas besoin d’un consultant BI pour construire la vue de direction : c’est une projection d’une source unique de vérité.

C’est pourquoi Builderforce.ai peut proposer une visibilité de niveau entreprise tarifée comme une plateforme. La partie coûteuse des logiciels d’entreprise a toujours été le rapprochement. Nous l’avons supprimé.

## Ce que l’on fait d’une source unique de vérité

Une fois chaque action instrumentée et attribuée, les mêmes données répondent à la question de chaque rôle sans nouveau pipeline :

- L’ingénierie voit DORA et quelle approche d’IA est réellement fusionnée.
- La finance voit le coût par résultat et peut fixer des budgets au lieu de lire des factures.
- Le PMO voit une consolidation de portefeuille avec des coûts réels et des résultats réels rattachés.
- La sécurité obtient des enregistrements conservés pour les chemins d’exécution d’agents instrumentés, les lacunes de couverture étant identifiées séparément.
- Le PDG voit le débit d’innovation et le retour sur investissement de l’ensemble de l’investissement dans l’IA.

Aucun de ces éléments n’est un produit distinct. Ce sont des perspectives sur un même enregistrement.

Le passage d’outils qui complètent automatiquement à un système de référence du travail est le véritable enjeu de l’ère agentique. Les agents n’ont jamais été le sujet. Le sujet, c’est que, pour la première fois, le travail s’écrit lui-même — et qu’une organisation qui le capture devient lisible pour elle-même comme elle ne l’a jamais été.
