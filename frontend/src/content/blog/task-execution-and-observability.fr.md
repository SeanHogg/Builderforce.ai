Quand un agent IA exécute une tâche, il se passe beaucoup de choses. Il planifie, appelle des outils, écrit des fichiers, délègue à d'autres agents, rend compte. Savoir *ce qui* s'est passé, *quand*, *quel agent* l'a fait et *si cela a réussi*, c'est toute la différence entre un système auquel vous faites confiance et un système qui vous inquiète.

Builderforce vous donne cette visibilité grâce à une pile en couches : les **tâches**, les **exécutions**, la **télémétrie des workflows** et la **chronologie du portail en temps réel**. Cet article passe en revue chacune de ces couches.

![Exécution des tâches et observabilité : une exécution passe par les états en attente, soumise, en cours, puis terminée ou en échec ; ses spans par outil s'affichent sur une chronologie où l'appel défaillant est mis en évidence, avec des tuiles de tableau de bord agrégées pour les totaux, les réussites, les échecs, la durée et les tokens](/blog/task-observability.svg)

---

## Le modèle de données

Comprendre ce que suit Builderforce, c'est comprendre quatre notions liées :

| Notion | Ce qu'elle représente |
|---|---|
| **Tâche** | Une unité de travail définie dans un projet (un élément du backlog, une fonctionnalité, un correctif) |
| **Exécution** | Une tentative précise d'exécuter cette tâche sur une instance BuilderForce Agents donnée |
| **Workflow** | Une orchestration structurée en plusieurs étapes qu'un agent BuilderForce Agents exécute pour mener à bien une tâche |
| **Tâche de workflow** | Une étape individuelle au sein d'un workflow (par exemple l'étape « coder » ou l'étape « reviewer ») |

Une même **tâche** peut donner lieu à plusieurs **exécutions** au fil du temps (nouvelles tentatives, relances). Chaque exécution est associée à exactement un **workflow** lorsque l'orchestrateur de BuilderForce Agents exécute un DAG pour la mener à bien.

---

## Cycle de vie d'une tâche

Les tâches suivent une progression de statuts bien définie :

```
backlog → todo → ready → in_progress → in_review → done
                                   └─► blocked
```

Vous gérez les tâches depuis la page [Tâches](/tasks). Chaque tâche enregistre :

- **La priorité** (`low`, `medium`, `high`, `urgent`) — elle détermine si un point d'approbation se déclenche automatiquement
- **L'agentHost assigné** — l'instance BuilderForce Agents qui doit l'exécuter
- **Le persona** — le rôle d'agent qui doit piloter l'exécution
- **L'URL de la PR GitHub** — liée automatiquement dès qu'un agentHost crée une pull request

---

## Cycle de vie d'une exécution

Lorsqu'une tâche est soumise pour exécution (via `POST /api/runtime/executions` ou via le dispatch du portail), un **enregistrement d'exécution** est créé et un événement `task.assign` est transmis à l'agentHost par le relais.

L'exécution suit cette machine à états :

```
pending → submitted → running → completed
                    └─► failed
                    └─► cancelled
```

L'agentHost signale automatiquement chaque transition à Builderforce :

- **running** — signalé dès que l'agent reçoit la tâche et commence à la traiter
- **completed** — signalé lorsque la session de chat de l'agent produit une réponse finale
- **failed** — signalé lorsque la session se termine sur une erreur

Vous pouvez suivre ces transitions en temps réel sur la page [Chronologie](/timeline) : la carte d'exécution se met à jour en direct à mesure que l'agentHost signale son statut.

---

## Télémétrie des workflows

Lorsque BuilderForce Agents exécute un workflow orchestré pour mener à bien une tâche, il émet des **spans de télémétrie structurés** — un par workflow et un par étape de tâche. Ces spans apparaissent à deux endroits :

### 1. JSONL local (sur l'agentHost)

```bash
# Every span is written locally on the agentHost
cat .builderforce/telemetry/2026-03-11.jsonl | jq .

# Find slow tasks
cat .builderforce/telemetry/2026-03-11.jsonl | \
  jq 'select(.kind == "task.complete") | {role: .agentRole, ms: .durationMs}' | \
  sort -t: -k2 -n
```

### 2. Portail Builderforce (en temps réel)

Les mêmes spans sont transmis au portail au fur et à mesure de leur émission :

- `workflow.start` → crée un enregistrement de workflow sur la page [Workflows](/workflows)
- `task.start` → ajoute une étape de tâche avec `status: running`
- `task.complete` / `task.fail` → met à jour l'étape avec son statut final et sa durée
- `workflow.complete` / `workflow.fail` → clôture l'enregistrement du workflow

La page Workflows offre ainsi une **vue en direct** de ce que fait chaque agentHost connecté à cet instant précis. Aucune requête manuelle nécessaire.

---

## La page Workflows

Rendez-vous sur [/workflows](/workflows) pour voir tous les workflows de votre flotte.

Vous pouvez filtrer par :

- **Statut** — en cours, terminé, en échec, en attente
- **Type de workflow** — feature, bugfix, refactor, planning, adversarial, custom
- **AgentHost** — pour cibler une machine précise

Chaque entrée de workflow se déplie pour afficher son DAG de tâches — les étapes individuelles avec le rôle de l'agent, la description, la durée et le statut. Les étapes en échec affichent directement le message d'erreur.

---

## Le tableau de bord des exécutions

[/observability](/observability) (ou le lien vers le tableau de bord depuis n'importe quelle page de projet) affiche des statistiques agrégées :

| Indicateur | Ce qu'il mesure |
|---|---|
| Total des exécutions | Toutes les exécutions sur la période sélectionnée |
| Terminées | Exécutions menées à bien |
| En échec | Exécutions terminées sur une erreur |
| En cours | Actuellement actives |
| Durée moyenne | Temps d'exécution moyen (exécutions terminées uniquement) |
| Consommation de tokens | Total des tokens consommés sur l'ensemble des exécutions |

Le tableau de bord ventile ces données par projet, par agentHost et par rôle d'agent, pour que vous puissiez voir quelles parties de votre système consomment le plus de ressources ou échouent le plus souvent.

---

## Événements d'audit des outils

Chaque appel d'outil effectué par un agent est consigné dans le **journal d'audit des outils**, consultable depuis [Journaux](/logs) :

```
timestamp   | agentHost     | tool         | duration | status
2026-03-11T | agentHost-7   | read_file    | 42ms     | success
2026-03-11T | agentHost-7   | bash         | 1.2s     | success
2026-03-11T | agentHost-7   | write_file   | 38ms     | success
2026-03-11T | agentHost-7   | bash         | 3.4s     | error
```

Chaque événement inclut l'intégralité des arguments d'entrée et du résultat, ce qui vous permet de retracer exactement ce que l'agent a fait à chaque étape. C'est la couche de débogage la plus fine : quand une exécution échoue, le journal d'audit des outils vous indique quel appel d'outil précis en est la cause.

---

## Streaming des exécutions en temps réel

Pour les exécutions qui comptent à l'instant présent, vous pouvez vous abonner aux mises à jour en direct via le flux WebSocket `GET /api/runtime/executions/:id/stream`. C'est ce qu'utilise en coulisses la carte d'exécution en direct du portail : chaque transition de statut et chaque événement de télémétrie sont transmis dès leur arrivée depuis l'agentHost.

Le flux fournit :

- des événements `status_change` à mesure que l'exécution change d'état
- des événements `done` lorsque l'exécution se termine ou échoue
- des instantanés de consommation de tokens issus de la session en cours

---

## Les specs : là où commence l'exécution

La primitive de planification de plus haut niveau sur Builderforce est la **spec** — un document de planification structuré qui se trouve dans le panneau de planification de [/tasks](/tasks).

Une spec passe par les étapes suivantes :

```
draft → reviewed → approved → in_progress → done
```

Chaque spec contient :

- **L'objectif** — le but exprimé en langage courant
- **Le PRD** — le document d'exigences produit (rédigé avec l'aide de l'IA dans [Remue-méninges](/brainstorm))
- **La spec d'architecture** — la conception technique, générée ou modifiée
- **La liste de tâches** — un tableau JSON de tâches dérivées de la spec, prêtes à être créées dans le tableau des tâches

Lorsqu'une spec passe à `approved`, sa liste de tâches devient un ensemble de tâches exécutables. À partir de là, le cycle de vie d'exécution décrit plus haut prend le relais.

---

## Bonnes pratiques

**Assignez explicitement les agentHosts aux tâches** lorsque vous disposez d'une flotte. Une tâche non assignée est diffusée à tous les agentHosts connectés — acceptable pour explorer, mais bruyant en production. Rattachez les tâches à l'agentHost qui dispose du bon espace de travail et du bon modèle.

**Choisissez les types de workflow à bon escient.** Un workflow `bugfix` passe par bug-analyzer → coder → test-generator. Un workflow `feature` enchaîne planner → architect → coder → reviewer → tester. Choisir le bon type, c'est garantir que les bons rôles d'agent interviennent dans le bon ordre, sans orchestration sur mesure.

**Consultez d'abord le journal d'audit pour déboguer.** Avant de relancer une exécution en échec, examinez les événements d'audit des outils de cette exécution. En général, l'échec tient à un seul appel d'outil — une commande bash qui a renvoyé un code de sortie non nul, ou une écriture de fichier qui s'est heurtée à une erreur de permission.

---

## Prochaines étapes

- Consultez vos exécutions en cours dans la [Chronologie](/timeline)
- Examinez les approbations en attente pour les tâches prioritaires dans les [approbations de l'Effectif](/workforce?tab=approvals)
- Explorez la page [Workflows](/workflows) pour voir ce que vos agentHosts orchestrent en ce moment
- Lisez [Points d'approbation et supervision humaine](/blog/approval-gates-and-human-oversight) pour savoir comment encadrer les étapes d'exécution à haut risque
