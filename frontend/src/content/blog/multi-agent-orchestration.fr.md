# Orchestration multi-agents avec le Mesh de Builderforce

Un seul agent généraliste peut répondre à des questions, écrire du code et rédiger des e-mails. Mais les flux de travail réels exigent souvent des **agents spécialistes qui travaillent de concert** : un planificateur, un codeur, un relecteur, un déployeur. Le Mesh de Builderforce est la couche qui les relie.

![Orchestration multi-agents : un agent orchestrateur décompose un objectif et dirige chaque sous-tâche vers un spécialiste — planificateur, codeur, relecteur, testeur, déployeur — en échangeant des passations JSON structurées entre les nœuds](/blog/multi-agent-orchestration.svg)

## Le modèle mental du Mesh

Voyez le Mesh comme un bus de messages entre agents. Chaque agent est un **nœud** qui :

- S’abonne à un ensemble de **types de tâches** qu’il sait traiter
- Publie ses résultats sur le bus
- Peut invoquer d’autres agents comme sous-tâches

L’orchestrateur (qui peut lui-même être un agent) décompose un objectif de haut niveau en sous-tâches et dirige chacune vers le nœud le plus compétent.

```
User prompt
    │
    ▼
Orchestrator Agent
    ├── → Planner Agent      → Plan document
    ├── → Coder Agent        → Implementation
    │       └── → Reviewer Agent → Code review
    └── → Deployer Agent     → Deployment manifest
```

## Enregistrer des agents dans la main-d’œuvre

Avant de pouvoir orchestrer, les agents doivent être **publiés** dans le registre de la main-d’œuvre. Chaque agent déclare :

- Un **nom** et une **description** visibles par les autres agents
- Un ensemble de **compétences** (étiquettes de capacités structurées)
- Un **point d’accès** (la passerelle BuilderForce Agents qui exécute l’agent)

La publication se fait en un clic depuis l’onglet Publier de l’IDE après l’entraînement.

## Mettre en place un flux de travail Mesh

### 1. Définir les rôles

Décidez de quels agents spécialistes votre flux de travail a besoin. Un pipeline de livraison logicielle pourrait utiliser :

| Rôle | Responsabilité |
|------|---------------|
| `planner` | Découpe la demande de fonctionnalité en tâches |
| `coder` | Implémente chaque tâche en TypeScript |
| `reviewer` | Relit les PR pour la justesse et le style |
| `tester` | Écrit et exécute des tests unitaires |

### 2. Affecter des compétences

Depuis la page [Compétences](/skills), affectez les compétences pertinentes à l’AgentHost de chaque agent. Les compétences injectent des connaissances métier : un agent `coder` doté de la compétence `typescript-strict`, par exemple, imposera une sécurité de typage plus stricte dans sa production.

### 3. Câbler l’orchestrateur

L’agent orchestrateur reçoit le prompt initial et répartit les sous-tâches. Dans un projet Builderforce, vous pouvez définir la logique d’orchestration dans un prompt système de discussion :

```
Tu es un orchestrateur. Lorsqu’on te remet une demande de fonctionnalité :
1. Utilise le Planner pour générer un découpage en tâches
2. Pour chaque tâche, invoque le Coder
3. Dirige chaque tâche terminée vers le Reviewer
4. Agrège le code relu et renvoie le diff final
```

Le Mesh gère le routage : l’orchestrateur appelle simplement les compétences des agents par leur nom.

## Partage du contexte

Les agents partagent le contexte au moyen de **passations structurées** : des charges utiles JSON qui portent l’état de la tâche, les sorties précédentes et des métadonnées. Builderforce sérialise et désérialise automatiquement ces charges utiles : chaque agent reçoit exactement le contexte dont il a besoin.

Le contexte de longue durée (historique de conversation, artefacts de code) peut être épinglé dans un bucket R2 partagé et référencé par identifiant, ce qui garde les charges utiles petites.

## Observabilité

La page [Observabilité](/observability) vous offre une vue en temps réel de :

- La circulation des messages entre agents
- La latence par nœud
- Les taux d’erreur et les nouvelles tentatives
- L’utilisation de jetons sur l’ensemble du mesh

C’est précieux pour déboguer des flux de travail multi-agents complexes : vous voyez exactement où une tâche a calé ou quel agent a produit une sortie inattendue.

## Bonnes pratiques

**Gardez les agents petits et ciblés.** Un agent codeur qui n’écrit que du Python est plus facile à évaluer et à améliorer qu’un agent qui écrit du code, le relit et le déploie en plus.

**Utilisez l’évaluation par IA sur chaque agent indépendamment.** Affinez avec des jeux de données ciblés plutôt qu’un seul corpus géant. Les scores d’évaluation du registre de la main-d’œuvre facilitent la comparaison des versions d’agents.

**Versionnez vos agents.** Publiez une nouvelle version quand vous réentraînez, et épinglez l’orchestrateur sur des versions d’agents précises pendant le développement pour éviter les régressions.

## Pour commencer

Prêt à construire un mesh ? Commencez par [entraîner deux agents](/dashboard) — un planificateur et un codeur —, publiez-les tous les deux, puis créez un projet d’orchestrateur qui les référence. L’interface des [discussions de la main-d’œuvre](/workforce?tab=chats) vous permet de tester le flux de travail orchestré de façon interactive avant de vous engager dans un pipeline de production.
