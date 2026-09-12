Toutes les équipes présentes sur Builderforce partagent la même infrastructure d'API. Aucune équipe ne peut voir les projets, agents, tâches ou conversations d'une autre. Cette isolation n'est pas une fonctionnalité ajoutée après coup — c'est l'hypothèse architecturale fondamentale autour de laquelle sont construits chaque requête en base de données, chaque route d'API et chaque dispatch d'agent.

Cet article explique le modèle de confiance, le système de contrôle d'accès, le fonctionnement de l'authentification des agents et ce que couvre la piste d'audit.

![Schéma de la sécurité multi-tenant de Builderforce : trois couloirs de tenants isolés séparés par des murs verrouillés, trois mécanismes d'authentification (JWT web, clé API d'AgentHost hachée, signature de dispatch HMAC-SHA256) et une isolation au niveau des requêtes où chaque requête limitée à un tenant porte un filtre eq(tenantId)](/blog/security-multitenant.svg)

---

## Le modèle de tenant

Un **tenant** est l'espace de travail isolé de votre organisation sur Builderforce. Toutes les ressources — projets, tâches, AgentHosts, agents, compétences, approbations, conversations — sont rattachées à un tenant. Il n'existe aucune visibilité ni aucun partage entre tenants.

Les utilisateurs appartiennent à un ou plusieurs tenants, avec un **rôle** précis dans chacun :

| Rôle | Ce qu'il permet |
|---|---|
| `viewer` | Accès en lecture seule aux projets, aux tâches, à l'historique de chat et à l'observabilité |
| `developer` | Accès en lecture et en écriture aux projets et aux tâches ; peut utiliser l'IDE et le chat |
| `manager` | Accès complet de développeur, plus : approuver/rejeter les points d'approbation, gérer les instances d'AgentHost, assigner des compétences, gérer les membres |
| `owner` | Accès complet de manager, plus : facturation, suppression du tenant, intégrations de gestion de code source |

Les rôles sont appliqués au niveau de l'API — chaque endpoint protégé vérifie le rôle de l'appelant par rapport au minimum requis avant de traiter la requête. Un développeur qui tente de valider un point d'approbation reçoit une `403`.

---

## Authentification

Builderforce utilise un **modèle d'authentification à double jeton**, conçu pour séparer proprement les sessions navigateur de l'accès API des agents.

### JWT web (sessions utilisateur)

Les utilisateurs du navigateur s'authentifient par e-mail et mot de passe et reçoivent un JWT de courte durée. Le jeton encode :

- `userId` — l'utilisateur authentifié
- `tenantId` — le contexte de tenant de cette session
- `role` — le rôle de l'utilisateur dans ce tenant
- `exp` — l'expiration (courte ; renouvelable)

Toutes les opérations JWT passent par les routes `/api/auth`. Les jetons peuvent être révoqués individuellement depuis la page des paramètres de sécurité.

### Authentification multifacteur

Les utilisateurs peuvent activer une MFA basée sur TOTP depuis [Paramètres → Sécurité](/security). Une fois celle-ci activée, chaque connexion exige le code TOTP en plus du mot de passe.

Des codes de récupération sont générés à l'activation de la MFA — conservez-les en lieu sûr. Ils sont hachés immédiatement et ne peuvent pas être récupérés.

### Clés API des AgentHosts

Les instances BuilderForce Agents n'utilisent pas de JWT. Chaque AgentHost enregistré reçoit, lors de son enregistrement, une **clé API en clair affichée une seule fois**. La clé est hachée immédiatement et la version en clair n'est jamais stockée — si vous la perdez, vous en générez une nouvelle.

L'AgentHost envoie cette clé via `Authorization: Bearer <key>` à chaque requête. L'API la vérifie par rapport au hachage stocké et résout le contexte de tenant à partir de la fiche d'enregistrement de l'AgentHost.

**Les clés n'apparaissent jamais dans les URL.** C'était une pratique historique sur certains endpoints Builderforce, qui a depuis été migrée — tous les endpoints authentifiés par AgentHost utilisent désormais uniquement l'en-tête `Authorization`, ce qui tient les clés à l'écart des journaux d'accès serveur et des caches CDN.

---

## Gestion des sessions

Chaque session navigateur active est suivie dans la table `auth_user_sessions`. Les managers peuvent consulter et révoquer les sessions de n'importe quel utilisateur de leur tenant depuis le panneau Sécurité.

La vue des sessions affiche :

| Champ | Valeur |
|---|---|
| ID de session | Identifiant unique |
| User agent | Navigateur et système d'exploitation |
| Adresse IP | Dernière IP connue |
| Créée le | Heure de début de la session |
| Dernière activité | Dernière requête authentifiée |
| Statut | Active ou révoquée |

Révoquer une session invalide tous les jetons émis dans son cadre. L'utilisateur est déconnecté à sa requête suivante.

---

## Confiance et sécurité du dispatch BuilderForce Agents

Le maillage d'AgentHosts introduit une surface de confiance supplémentaire : le dispatch d'AgentHost à AgentHost. Quand l'AgentHost A envoie une tâche à l'AgentHost B, ce dernier doit vérifier que la requête provient bien de l'AgentHost A — et non d'un attaquant qui aurait découvert son endpoint.

Builderforce utilise la **signature de charge utile HMAC-SHA256** pour tout dispatch entre AgentHosts :

```
AgentHost A sends:
  POST /api/agent-hosts/:id/forward
  Authorization: Bearer <agentHostApiKey>
  X-AgentHost-Signature: sha256=<hmac>
  X-AgentHost-From: <sourceAgentHostId>
  Body: { task: "..." }
```

Le HMAC est calculé sur le corps brut de la requête, avec la clé API de l'AgentHost émetteur comme secret. L'AgentHost destinataire (via le `verifyAgentHostSignature` de Builderforce) recalcule le HMAC et compare. En cas de non-correspondance, une `403` est renvoyée avant tout traitement de la charge utile.

En l'absence de signature, Builderforce accepte la requête par souci de rétrocompatibilité — mais consigne cette absence. Dans une prochaine version de durcissement, l'absence de signature sur les tâches transférées entraînera un rejet ferme.

---

## Le journal d'audit

Chaque action significative dans Builderforce est consignée dans le **journal d'audit** — accessible sur [/admin](/admin) pour les propriétaires et les managers.

Le journal d'audit capture :

| Type d'événement | Ce qui l'a déclenché |
|---|---|
| `tenant.member_added` | Utilisateur ajouté au tenant |
| `tenant.member_removed` | Utilisateur retiré du tenant |
| `agentHost.registered` | Nouvelle instance BuilderForce Agents créée |
| `agentHost.status_changed` | AgentHost activé, désactivé ou suspendu |
| `approval.created` | Un agent a sollicité un point d'approbation |
| `approval.decided` | Un manager a approuvé ou rejeté |
| `task.created` | Tâche créée sur le tableau |
| `execution.submitted` | Tâche soumise pour exécution |
| `execution.state_changed` | Exécution passée à l'état en cours / terminée / en échec |
| `project.created` | Nouveau projet créé |
| `skill.assigned` | Compétence assignée au tenant ou à un AgentHost |

Chaque événement enregistre : qui, quoi, quand, quelle ressource (type et ID), ainsi que des métadonnées structurées.

### Événements d'audit des outils

Distinct du journal d'audit du tenant, le **journal d'audit des outils** enregistre chaque appel d'outil effectué par un agent BuilderForce Agents : le nom de l'outil, les arguments d'entrée, le résultat, la durée, et s'il a réussi ou échoué. Ce journal fait foi pour savoir « ce que l'agent a réellement fait » — utile pour le débogage comme pour les revues de conformité.

---

## Architecture d'isolation des données

L'isolation multi-tenant est appliquée au niveau des requêtes en base de données — et non au niveau de la logique applicative.

Chaque requête sur une table rattachée à un tenant inclut une condition `tenantId` explicite :

```typescript
const rows = await db
  .select()
  .from(projects)
  .where(
    and(
      eq(projects.tenantId, tenantId),  // always present
      eq(projects.status, 'active'),
    )
  );
```

Il n'existe aucun chemin « tout sélectionner » qui omette le filtre de tenant. Même si la logique applicative comportait un bug, la requête ne renverrait pas les données d'un autre tenant.

Les instances BuilderForce Agents sont elles aussi rattachées à un tenant — un AgentHost enregistré auprès du tenant A ne peut pas recevoir de tâches dispatchées par le tenant B, ne peut pas apparaître dans la vue flotte du tenant B et ne peut pas lire le contexte des projets du tenant B.

---

## Contrôles de confidentialité

Builderforce prend en charge les demandes relevant du RGPD et du CCPA. Les utilisateurs peuvent soumettre une demande de suppression ou d'accès à leurs données depuis les paramètres de leur compte, ou un manager peut la soumettre en leur nom.

Les demandes de confidentialité suivent un workflow formel :

```
submitted → in_review → completed / closed
```

Toutes les données personnelles associées à la demande (historique de chat, événements d'audit, instantanés d'utilisation) peuvent être supprimées sur demande, conformément à la réglementation applicable.

---

## Sécurité de la gestion de code source

Lorsque vous connectez un compte GitHub ou Bitbucket via l'intégration de gestion de code source, Builderforce ne stocke que :

- L'identifiant du compte (organisation/nom d'utilisateur)
- L'URL de l'hôte (pour GitHub Enterprise auto-hébergé)
- Le type d'intégration

Aucun jeton OAuth ni PAT n'est stocké dans la base de données de Builderforce. La gestion des jetons est assurée par l'instance BuilderForce Agents qui effectue les opérations git.

---

## Feuille de route sécurité

Plusieurs améliorations de sécurité sont prévues pour la phase 2 et au-delà :

- **Signatures HMAC obligatoires** — rejet de tout dispatch non signé entre AgentHosts, sans période de rétrocompatibilité
- **Appareils de confiance** — enregistrement d'appareils de confiance ; nouvelle authentification exigée depuis tout nouvel appareil
- **Listes d'IP autorisées** — restriction de l'accès au tenant à des plages CIDR précises
- **SSO** — SAML et OIDC pour les fournisseurs d'identité d'entreprise
- **Export SIEM** — diffusion des événements d'audit vers des systèmes de journalisation externes via OTel

---

## Bonnes pratiques

**Renouvelez les clés API des AgentHosts chaque trimestre.** Une clé qui n'a jamais été renouvelée est une clé qui traîne peut-être depuis des mois dans un fichier d'historique du shell. Enregistrez une nouvelle clé, mettez à jour la variable d'environnement de l'AgentHost, redémarrez-le et révoquez l'ancienne clé.

**Attribuez le rôle minimal nécessaire.** Les développeurs n'ont pas besoin de l'accès `MANAGER`. Les relecteurs n'ont pas besoin de l'accès `DEVELOPER`. L'attribution des rôles doit correspondre aux responsabilités réelles.

**Activez la MFA pour tous les managers et propriétaires.** Les comptes développeurs, avec leur accès en lecture/écriture, sont des cibles de valeur ; les comptes managers, qui peuvent approuver des actions destructrices, le sont plus encore.

**Consultez le journal d'audit des outils après tout comportement inattendu d'un agent.** Avant de relancer un workflow qui a produit un résultat surprenant, lisez ce que l'agent a réellement fait — le journal d'audit des outils est la référence qui fait foi.

---

## Prochaines étapes

- Passez en revue les rôles attribués au sein de votre équipe dans [Paramètres → Membres](/settings)
- Activez la MFA depuis [Paramètres → Sécurité](/security)
- Consultez le [journal d'audit](/admin) pour voir les événements significatifs récents de votre tenant
- Lisez [Points d'approbation et supervision humaine](/blog/approval-gates-and-human-oversight) pour découvrir les contrôles avec humain dans la boucle qui complètent la sécurité de la plateforme
