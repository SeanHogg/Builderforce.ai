# Exécution autonome par couloir — transformez votre tableau Kanban en une main-d’œuvre autonome

La plupart des outils de codage par IA vous attendent. Vous ouvrez l’éditeur, tapez un prompt, lisez la suggestion, l’acceptez, et recommencez. L’agent est rapide, mais *vous* êtes la boucle : chaque étape attend qu’un humain la fasse avancer.

Builderforce.ai inverse cela. **Affectez un agent IA à un couloir Kanban, et le tableau se met à avancer tout seul.** Les tickets sont envoyés automatiquement à l’agent affecté, le tableau progresse de couloir en couloir à mesure que le travail se termine, et l’exécution ne s’interrompt qu’aux points d’approbation que vous décidez de conserver. Vous gérez des *résultats* sur un tableau au lieu de surveiller des *prompts* dans une fenêtre de discussion.

> L’exécution autonome par couloir vous permet d’affecter n’importe quel agent — Cloud ou sur site — à un couloir Kanban. Les tickets sont envoyés automatiquement et le tableau avance de lui-même à mesure que les agents terminent, ne s’arrêtant qu’aux points d’approbation que vous choisissez.

![Exécution autonome par couloir : un ticket traverse les couloirs Backlog, Build, Review et Done, chacun doté d’un agent affecté, avec un point d’approbation suspendant l’exécution avant la fusion dans Done](/blog/autonomous-swimlanes.svg)

## Comment cela fonctionne

Un couloir du tableau de tâches de Builderforce.ai est une colonne de statut — `Backlog`, `In Progress`, `In Review`, `Done`, ou n’importe quelle étape de flux de travail personnalisée que vous définissez. Normalement, un humain fait glisser un ticket d’un couloir au suivant. Avec l’exécution autonome, vous associez un agent et un modèle à un couloir, et ce couloir devient un **travailleur** :

1. **Un ticket arrive dans le couloir.** Il peut y arriver parce que vous l’y avez créé, parce qu’un couloir en amont a terminé son travail, ou parce qu’un flux de travail l’y a acheminé.
2. **L’agent du couloir le prend en charge.** La référence d’agent configurée et le modèle épinglé accompagnent l’envoi : aucun repli sur un modèle par défaut médiocre.
3. **L’agent fait le travail.** Il clone le dépôt lié via un proxy git sécurisé côté serveur, effectue la modification, lance la compilation et ouvre une pull request, en mode headless, sans navigateur ouvert.
4. **Le tableau avance.** Lorsque l’agent a terminé, le ticket passe automatiquement au couloir suivant. Si ce couloir a lui aussi un agent, le relais se poursuit.
5. **Il s’arrête à vos points de contrôle.** Toute transition de couloir peut exiger une approbation humaine. L’exécution est suspendue, vous recevez une notification Slack ou e-mail, et rien d’important ne se produit tant que vous n’avez pas approuvé.

Le résultat est un pipeline de livraison que vous pouvez *regarder* plutôt que *piloter*. Un ticket peut parcourir `Backlog → Build → Review → Done`, avec deux agents spécialistes différents pour Build et Review, et une seule approbation humaine avant la fusion.

## Agents cloud et agents sur site, sur le même tableau

Les couloirs autonomes fonctionnent avec les deux types d’agents de Builderforce.ai :

- **Les agents cloud** s’exécutent entièrement dans le cloud — un environnement d’exécution durable qui survit aux redémarrages et avance une étape à la fois, afin que les longues tâches ne meurent pas contre un mur de délai d’expiration de requête.
- **Les agents sur site** s’exécutent sur votre propre machine (un ou plusieurs par hôte), gardant votre code et vos identifiants à l’intérieur de votre réseau.

Vous pouvez les combiner. Un agent cloud peut trier et rédiger une modification pendant qu’un agent sur site exécute les parties qui doivent rester sur votre matériel. Le tableau ne se soucie pas de l’endroit où vit le travailleur ; il lui importe seulement que le couloir en ait un.

## Pourquoi c’est important : des résultats, pas des prompts

Le passage d’un travail *piloté par les prompts* à un travail *piloté par le tableau* est tout l’intérêt d’une main-d’œuvre d’agents :

| Outils pilotés par les prompts | Builderforce.ai piloté par le tableau |
|---|---|
| Vous lancez chaque étape | Les couloirs lancent le travail automatiquement |
| Un agent, une suggestion à la fois | Plusieurs agents, chacun responsable d’un couloir |
| La progression vit dans un journal de discussion | La progression vit sur un tableau partagé |
| La gouvernance est greffée après coup (ou absente) | Les points d’approbation font partie du modèle de couloir |
| Le contexte est réinitialisé à chaque session | La mémoire de projet persistante survit aux redémarrages |

Un responsable qui regarde le tableau voit exactement ce que fait chaque agent, ce qui est bloqué en attente d’approbation et ce qui a été livré, comme il suivrait une équipe de personnes. C’est pourquoi nous décrivons Builderforce.ai comme un **cloud entièrement agentique avec l’humain dans la boucle** : les agents font le travail, vous gardez le contrôle aux points de passage.

## La gouvernance est intégrée, pas greffée

L’autonomie sans contrôle est un risque. Chaque transition de couloir autonome est soumise à la même couche de gouvernance qui enveloppe le reste de la plateforme :

- **Les points d’approbation** suspendent l’exécution jusqu’à ce qu’un humain approuve ou rejette — par type d’action, plafond de coût ou nombre de fichiers modifiés.
- **Les règles d’approbation automatique** laissent passer automatiquement les actions à faible risque pour que les humains ne voient que ce qui compte.
- **Une piste d’audit complète** consigne chaque envoi, appel d’outil, jeton et décision.
- **L’escalade** fait expirer les approbations arrivées à échéance et alerte les bonnes personnes.

C’est vous qui décidez de la marge de manœuvre de chaque couloir. Une transition `Backlog → Build` peut s’exécuter de façon entièrement autonome, tandis que `Review → Merge` attend toujours une personne.

## Pour commencer

1. Ouvrez un projet et passez à l’onglet **Tâches** — votre tableau Kanban en direct.
2. Configurez un couloir : choisissez l’agent (Cloud ou sur site) et épinglez un modèle.
3. Décidez quelles transitions de couloir exigent une approbation.
4. Déposez un ticket dans le couloir et regardez le tableau se mettre en mouvement.

Vous ne quittez jamais le tableau — et si vous préférez rester dans votre éditeur, l’extension VS Code de BuilderForce affiche nativement le même tableau : vous pouvez approuver des actions et voir les couloirs avancer sans quitter VS Code.

L’exécution autonome par couloir, c’est la différence entre une IA qui *vous aide à coder* et une main-d’œuvre IA qui *livre le ticket*. Mettez un couloir au travail et gérez le résultat.

[Commencez gratuitement →](/register) · [Visitez la plateforme →](/product) · [Voyez comment nous nous comparons →](/compare)
