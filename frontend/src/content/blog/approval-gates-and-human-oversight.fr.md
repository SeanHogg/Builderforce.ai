Les agents autonomes sont puissants. C'est aussi précisément ce qui les rend dangereux sans les bons garde-fous. Un agent capable de pousser du code, de modifier la configuration de production ou d'envoyer des messages en votre nom est extraordinairement utile — jusqu'au jour où il fait quelque chose que vous n'aviez pas prévu.

Le système de **points d'approbation** de Builderforce.ai règle ce problème au niveau de l'infrastructure. Vous définissez quels types d'actions exigent une validation humaine ; la plateforme bloque l'exécution jusqu'à ce qu'un manager approuve ou refuse ; l'agent ne reprend qu'une fois la décision enregistrée. Toute la boucle est auditée.

![Schéma d'un point d'approbation : un agent qui exécute une tâche atteint un point d'approbation qui bloque l'exécution via POST /api/approvals ; un manager approuve, refuse ou laisse expirer la demande, et chaque issue est consignée dans une piste d'audit immuable](/blog/approval-gates.svg)

---

## Comment fonctionnent les points d'approbation

Le flux implique trois participants : l'**agent** (qui s'exécute dans BuilderForce Agents), le **portail Builderforce** (où l'approbation est présentée à un humain) et le **manager** (un membre de l'équipe doté du rôle `MANAGER` ou supérieur).

```
Agent runs a task
    │
    └─► "This action requires approval"
            │
            ▼
    POST /api/approvals ──────────────────────────────────────┐
            │                                                  │
            ▼                                                  ▼
    Agent suspends execution              Portal notifies manager
    (awaiting decision)                   via dashboard + relay push
            │                                                  │
            └──────────────── Manager approves/rejects ────────┘
                                          │
                             approval.decision pushed to agentHost
                                          │
                               ┌──────────▼──────────┐
                               │ approved → continue  │
                               │ rejected → abort     │
                               └──────────────────────┘
```

La propriété essentielle : **l'exécution est réellement bloquée**. L'agent ne continue pas, ne relance pas, n'expire pas en silence. Il attend — jusqu'à un délai configurable — une vraie décision prise par une vraie personne.

---

## La page des approbations

Rendez-vous dans les [approbations de l'onglet Effectif](/workforce?tab=approvals) pour voir les demandes en attente, approuvées et refusées de votre équipe.

Chaque demande d'approbation affiche :

| Champ | Description |
|---|---|
| **Type d'action** | Ce que l'agent tentait de faire (`git.push`, `deploy`, `task.execution`, etc.) |
| **Description** | La justification, en langage clair, fournie par l'agent |
| **Demandé par** | L'instance BuilderForce Agents qui a soumis la demande |
| **Demandé le** | L'horodatage de la demande |
| **Expire le** | Le moment où la demande expirera automatiquement faute de réponse |
| **Métadonnées** | Le contexte structuré (ID de tâche, priorité, liste de fichiers, estimation de coût, etc.) |

Approuver ou refuser se fait en un seul clic. Vous pouvez aussi ajouter une **note de revue**, enregistrée avec la décision et visible dans le journal d'audit.

---

## Ce qui déclenche un point d'approbation

Il existe deux sources :

### 1. Les points automatiques (imposés par la plateforme)

Le runtime Builderforce évalue automatiquement un point d'approbation lorsqu'une tâche est soumise pour exécution si :

- La **priorité de la tâche est `high` ou `urgent`**

C'est le filet de sécurité par défaut : les tâches à fort enjeu font toujours l'objet d'une revue humaine avant qu'un agent ne commence à les exécuter.

### 2. Les points explicites (demandés par l'agent)

Les agents BuilderForce Agents peuvent demander une approbation à tout moment de l'exécution en appelant `requestApproval()` :

```typescript
import { requestApproval } from "@builderforce/approval-gate";

const decision = await requestApproval({
  actionType: "git.push",
  description: "Push 42 changed files to the main branch",
  metadata: {
    files: changedFiles,
    branch: "main",
    estimatedRisk: "high",
  },
  timeoutMs: 10 * 60 * 1000, // 10 minute window
});

if (decision !== "approved") {
  throw new Error(`Push not approved: ${decision}`);
}

await git.push("origin", "main");
```

L'agent reste suspendu sur `await requestApproval(...)` jusqu'à ce que :
- Un manager approuve → renvoie `"approved"`
- Un manager refuse → renvoie `"rejected"`
- Le délai expire → renvoie `"timeout"`

Pas de polling, pas de revérification manuelle : la décision est poussée vers l'agentHost dès que le manager agit.

---

## Exigences de rôle

Seuls les utilisateurs dotés du rôle `MANAGER` ou `OWNER` peuvent approuver ou refuser une demande. Les lecteurs et les développeurs voient les approbations en attente mais ne peuvent pas y donner suite.

C'est voulu. Le pouvoir d'approbation est un contrôle de gouvernance : il doit revenir aux mêmes personnes que celles qui ont les droits de déploiement, pas à toute l'équipe.

Vous pouvez gérer les rôles de l'équipe depuis [Paramètres → Membres](/settings).

---

## Notifications

Lorsqu'une demande d'approbation arrive, le manager la voit à trois endroits :

1. **Le portail** — le badge des [approbations de l'onglet Effectif](/workforce?tab=approvals) se met à jour en temps réel dans la barre latérale
2. **Le relais** — si une session de navigateur est ouverte sur la vue de discussion de l'agentHost concerné, un événement `approval.request` arrive immédiatement
3. **Les canaux de messagerie** (prévus en phase 2) — notifications Slack, Telegram et e-mail pour les demandes d'approbation

---

## Piste d'audit

Chaque décision d'approbation est définitive et immuable. Le [Journal d'audit](/admin) enregistre :

- Qui a demandé l'approbation (ID de l'agentHost)
- Qui a pris la décision (ID de l'utilisateur)
- La nature de la décision et son moment
- La note de revue, le cas échéant

C'est votre piste de conformité. Si un déploiement a mal tourné et que vous devez savoir qui l'a approuvé et pourquoi, c'est ici que vous regardez.

---

## Délais et expiration automatique

Les demandes d'approbation comportent un horodatage `expiresAt` facultatif. Lorsqu'une demande expire :

- Son statut passe à `expired`
- L'agent en attente reçoit une décision `"timeout"`
- Il revient à l'agent de décider s'il abandonne ou s'il réessaie

Le délai par défaut de BuilderForce Agents est de 10 minutes pour les demandes interactives des agents. Pour les workflows en arrière-plan de plus longue durée, vous pouvez configurer une fenêtre plus longue.

---

## Bonnes pratiques

**Définissez les types d'action comme une taxonomie.** Utilisez des chaînes cohérentes comme `git.push`, `deploy.production`, `db.migrate`, `file.delete-bulk` plutôt que des descriptions libres. Le journal d'audit devient ainsi filtrable, et vous pourrez ajouter des règles d'automatisation plus tard.

**Filtrez selon le risque, pas selon la fréquence.** Toutes les actions n'ont pas besoin d'une approbation — seulement celles dont le rayon d'impact est significatif. Les écritures en production, les opérations destructrices sur les fichiers et les appels à des API externes qui coûtent de l'argent ou envoient des communications sont des points d'approbation naturels.

**Gardez des approbations ciblées.** Une demande d'approbation doit porter sur une seule décision. « Pousser ces 42 fichiers » est exploitable. « Faire tout le déploiement » ne l'est pas — découpez-le en points de contrôle qu'un manager peut examiner de façon pertinente.

**Fixez des délais réalistes.** Un agent bloqué 24 heures dans l'attente d'une approbation qui arrive à 9 h, c'est acceptable pour des workflows peu urgents. Pour des pipelines en direct face aux utilisateurs, choisissez des délais plus courts avec un comportement de repli clair.

---

## Prochaines étapes

- Ouvrez les [approbations de l'onglet Effectif](/workforce?tab=approvals) pour voir les demandes en attente sur les agentHosts de votre équipe
- Lisez [L'exécution des tâches et le portail](/blog/task-execution-and-observability) pour comprendre comment les approbations s'articulent avec le cycle de vie de l'exécution
- Consultez [L'orchestration multi-agents](/blog/multi-agent-orchestration) pour découvrir des modèles qui combinent points d'approbation et workflows en plusieurs étapes
