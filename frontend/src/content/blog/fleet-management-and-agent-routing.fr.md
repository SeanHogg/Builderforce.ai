Une seule instance BuilderForce Agents sur le portable d'un développeur est déjà puissante. Une flotte de dix — chacune spécialisée dans un type de travail différent, réparties sur plusieurs machines, qui acheminent chaque tâche vers l'instance la mieux adaptée — c'est tout autre chose.

Builderforce.ai est le plan de contrôle de cette flotte. Cet article explique comment enregistrer des instances, déclarer des capacités, router intelligemment les tâches et superviser votre maillage depuis le portail.

![Routage de flotte : une tâche entrante qui déclare les capacités requises est évaluée par le routeur de flotte face aux AgentHosts en ligne, puis dispatchée vers l'hôte le mieux adapté, tandis que les hôtes hors ligne ou partiellement compatibles sont ignorés ou gardés en réserve](/blog/fleet-routing.svg)

---

## Qu'est-ce qu'une flotte d'AgentHosts ?

Une **flotte d'AgentHosts** regroupe toutes les instances BuilderForce Agents enregistrées auprès de votre tenant. Chaque instance est une machine qui exécute la passerelle BuilderForce Agents — le portable d'un développeur, un serveur dédié, un worker de CI ou une VM dans le cloud.

Depuis le portail Builderforce, votre flotte est visible dans le [Tableau de bord](/dashboard) et dans le panneau de détail de chaque AgentHost. Chaque AgentHost affiche :

- **Statut** — en ligne / hors ligne (selon l'ancienneté du dernier heartbeat)
- **Profil machine** — nom d'hôte, IP, chemin de l'espace de travail, URL du tunnel
- **Dernière activité** — le moment où l'AgentHost a envoyé son dernier heartbeat
- **Capacités** — ce que l'AgentHost déclare savoir faire
- **Projets assignés** — les projets qui lui sont liés
- **Statistiques d'utilisation** — consommation de tokens récente, nombre d'exécutions

---

## Enregistrer un nouvel AgentHost

Pour ajouter un AgentHost à votre flotte :

1. Allez dans le [Tableau de bord](/dashboard) → **Ajouter un AgentHost**
2. Donnez-lui un nom et un slug (par ex. `backend-server-1`)
3. Copiez la clé API générée — elle n'est affichée **qu'une seule fois** et ne pourra plus être récupérée
4. Sur la machine cible, définissez :

```bash
export BUILDERFORCE_AGENTS_LINK_API_KEY=<your-api-key>
export BUILDERFORCE_AGENTS_LINK_URL=https://api.builderforce.ai
builderforce start
```

L'AgentHost s'enregistre automatiquement dès son premier heartbeat. Son profil machine, le chemin de son espace de travail et ses métadonnées réseau sont renseignés à partir de la charge utile de ce premier heartbeat.

---

## Heartbeats et présence

Un AgentHost connecté envoie un **heartbeat** toutes les 5 minutes via `PATCH /api/agent-hosts/:id/heartbeat`. Le heartbeat met à jour :

- `lastSeenAt` — sert à déterminer le statut en ligne / hors ligne
- `connectedAt` — défini lors du premier heartbeat
- `capabilities` — l'ensemble des capacités déclarées (voir ci-dessous)
- `machineProfile` — nom d'hôte, IP, ports, URL du tunnel

Un AgentHost est considéré comme **en ligne** si son `lastSeenAt` date de moins de 10 minutes. Si un AgentHost passe hors ligne, les tâches qui lui sont assignées restent en file d'attente — elles ne sont pas réacheminées automatiquement, sauf si vous configurez une solution de repli.

---

## Déclarations de capacités

Les capacités constituent le vocabulaire de routage du maillage. Un AgentHost déclare ce qu'il sait faire ; le portail s'appuie sur ces déclarations pour acheminer chaque tâche vers la meilleure correspondance.

Chaque AgentHost déclare ses capacités dans la charge utile de son heartbeat :

```json
{
  "capabilities": ["chat", "tasks", "relay", "remote-dispatch"],
  "declaredCapabilities": ["typescript", "react", "testing", "refactor"]
}
```

Le premier ensemble (`capabilities`) correspond à la surface du protocole BuilderForce Agents. Le second (`declaredCapabilities`) est votre vocabulaire personnalisé — les étiquettes que vous utilisez pour catégoriser le travail, quelles qu'elles soient.

### Interroger par capacité

Depuis n'importe quel AgentHost (ou via le portail), vous pouvez demander : *« quel AgentHost de la flotte est le mieux adapté à ce travail ? »*

```
GET /api/agent-hosts/fleet/route?requires=typescript,testing
```

La réponse renvoie l'AgentHost en ligne le mieux adapté à l'ensemble de capacités demandé, en donnant la priorité aux AgentHosts qui déclarent toutes les capacités requises.

---

## Routage intelligent avec `remote:auto`

Toute la puissance des déclarations de capacités se révèle dans le **routage automatique** au sein des workflows BuilderForce Agents.

Lorsque vous indiquez `remote:auto[caps]` comme rôle d'agent dans un workflow, l'AgentHost qui dispatche interroge la flotte, trouve la meilleure correspondance et lui transmet la tâche :

```yaml
# .builderforce/workflows/feature-build.yaml
steps:
  - role: planner
    description: "Break down the feature into tasks"

  - role: remote:auto[typescript,react]
    description: "Implement the UI components"

  - role: remote:auto[testing]
    description: "Write unit tests for the implementation"

  - role: reviewer
    description: "Review the complete implementation"
```

L'étape `remote:auto[typescript,react]` est dispatchée vers l'AgentHost en ligne de la flotte qui correspond le mieux à ces deux capacités. Si cet AgentHost est occupé, la meilleure correspondance suivante est retenue.

---

## Routage manuel avec `remote:<id>`

Lorsque vous voulez un routage déterministe — par exemple, toujours exécuter les tâches frontend sur un poste de travail précis — utilisez directement le slug ou l'identifiant numérique de l'AgentHost :

```
remote:frontend-workstation
remote:42
```

Cela court-circuite l'évaluation des capacités et dispatche directement vers cet AgentHost. Si l'AgentHost est hors ligne, la tâche échoue immédiatement au lieu de basculer vers une solution de repli.

---

## Le panneau de détail de l'AgentHost

Cliquez sur n'importe quel AgentHost dans le [Tableau de bord](/dashboard) pour ouvrir son panneau de détail. Le panneau comporte plusieurs onglets :

### Chat
Un terminal en direct sur la session de chat active de l'AgentHost — vous pouvez envoyer des tâches, voir les réponses s'afficher en streaming et regarder l'agent travailler en temps réel.

### Sessions
L'historique de toutes les sessions exécutées sur cet AgentHost, avec heure de début, durée et consommation de tokens. Cliquez sur une session pour voir sa transcription complète.

### Projets
Les projets auxquels cet AgentHost est assigné. Vous pouvez assigner et retirer des projets depuis cet onglet.

### Compétences
Les compétences (skills) actuellement chargées sur cet AgentHost — aussi bien les affectations au niveau du tenant que les surcharges propres à l'AgentHost. Les modifications prennent effet au prochain redémarrage de l'AgentHost (les compétences sont récupérées au démarrage).

### Espace de travail
Le répertoire que cet AgentHost a synchronisé avec Builderforce — inventaire des fichiers, état de synchronisation et horodatage de la dernière synchronisation.

### Utilisation
Consommation de tokens par session, taux d'utilisation de la fenêtre de contexte et événements de compaction. Pratique pour repérer une saturation du contexte avant qu'elle ne pose problème.

### Débogage
Profil machine brut, métadonnées réseau, état de la connexion au relais et les 20 dernières charges utiles de heartbeat. C'est le premier endroit à consulter quand un AgentHost se retrouve hors ligne sans raison apparente.

---

## Affectation de projets

Un AgentHost sans projet assigné n'a aucun contexte — il ne sait pas quelle base de code, quelles règles ni quelle mémoire charger. Assignez au moins un projet à chaque AgentHost :

1. Ouvrez le panneau de détail de l'AgentHost → onglet **Projets**
2. Cliquez sur **Assigner un projet** et sélectionnez le projet
3. L'AgentHost récupère le contexte d'affectation mis à jour lors de son prochain heartbeat

Un AgentHost peut être assigné à plusieurs projets. Le projet actif est déterminé par la tâche en cours d'exécution — l'AgentHost charge automatiquement le contexte du projet correspondant.

---

## Dispatch d'AgentHost à AgentHost

Les AgentHosts d'une même flotte peuvent se déléguer des tâches directement, sans passer par le portail. C'est le **maillage d'AgentHost à AgentHost**.

Tout dispatch entre AgentHosts est :

- **Signé par HMAC** — chaque charge utile porte un en-tête `X-AgentHost-Signature: sha256=<hex>` ; l'AgentHost destinataire vérifie la signature avant toute exécution
- **Authentifié par Bearer** — `Authorization: Bearer <apiKey>` sur chaque requête
- **Assisté par relais** — les AgentHosts situés derrière un NAT ou un pare-feu se joignent via le Durable Object `AgentHostRelayDO` de Builderforce ; aucun chemin réseau direct n'est nécessaire

La topologie du relais se présente ainsi :

```
AgentHost A (laptop) ──────────────────────────────► Builderforce relay
                                                      │
                                         dispatches to AgentHost B via relay
                                                      │
                                              AgentHost B (server) ◄───────
```

Aucun des deux AgentHosts n'a besoin d'être joignable depuis le réseau de l'autre. Builderforce se charge du routage.

---

## Visibilité de la flotte à grande échelle

Pour les équipes qui exploitent de nombreux AgentHosts, la vue flotte du [Tableau de bord](/dashboard) affiche toutes les instances dans un seul tableau. Vous pouvez filtrer par :

- **Statut** — en ligne uniquement
- **Projet** — les AgentHosts assignés à un projet donné
- **Capacité** — les AgentHosts qui déclarent une étiquette de capacité donnée

La vue flotte est le poste de commandement de votre maillage. Besoin de mettre en pause le travail d'un AgentHost ? Passez son statut à `inactive`. Vous soupçonnez un AgentHost de mal se comporter ? Consultez son journal d'audit des outils. Besoin de déployer une nouvelle affectation de compétence sur tous les AgentHosts ? Mettez-la à jour au niveau du tenant, et chaque AgentHost la récupère à son prochain démarrage.

---

## Bonnes pratiques

**Donnez aux AgentHosts des noms parlants.** `agentHost-1`, `agentHost-2`, cela devient vite ingérable. `backend-sean-mbp`, `frontend-ci-worker`, `refactor-server` rendent la vue flotte lisible au premier coup d'œil.

**Déclarez les capacités avec précision.** Évitez les déclarations fourre-tout comme `general` ou `everything`. Plus votre vocabulaire de capacités est précis, meilleures sont les décisions de routage automatique. Si un AgentHost est bon en Python et mauvais en TypeScript, déclarez `python` et pas `typescript`.

**Assignez si possible un seul projet principal par AgentHost.** Les AgentHosts qui cumulent les affectations chargent davantage de contexte au démarrage et risquent d'acheminer le travail vers le mauvais contexte de projet. Un AgentHost, une base de code : c'est le modèle mental le plus clair.

**Surveillez `lastSeenAt` en production.** Configurez une alerte Grafana (ou utilisez les hooks de notification du portail dès qu'ils seront disponibles) si un AgentHost reste hors ligne plus de 15 minutes pendant les heures de travail — c'est généralement le signe d'un plantage de processus ou d'un changement de réseau.

---

## Prochaines étapes

- Enregistrez un nouvel AgentHost depuis le [Tableau de bord](/dashboard) → Ajouter un AgentHost
- Découvrez [l'orchestration multi-agents](/blog/multi-agent-orchestration) pour voir comment `remote:auto` s'intègre dans un workflow complet
- Lisez [L'affectation des compétences](/blog/skills-assignment-and-the-marketplace) pour comprendre comment doter les AgentHosts de votre flotte de capacités gérées depuis le portail
