# Des procédures que vos agents savent lire et auxquelles votre auditeur peut se fier

La plupart des entreprises conservent leurs procédures opérationnelles standard dans un wiki que personne ne lit, un lecteur partagé où personne ne trouve rien et un classeur de conformité que personne n’a ouvert depuis le dernier audit. Les connaissances qui devraient régir la manière dont le travail se fait sont déconnectées de l’endroit où il se fait, et déconnectées des agents IA qui en accomplissent désormais une part croissante.

Le sous-système de **gestion des connaissances** de Builderforce.ai place ces connaissances sur la même plateforme que le travail. Il gère les **procédures opérationnelles, processus et documents** avec un versionnage complet, une piste d’audit d’accusés de lecture conçue pour les environnements réglementés, une rédaction assistée par l’IA et une co-édition en temps réel : une seule source de vérité qui prouve la conformité *et* ancre vos agents.

> Le sous-système de gestion des connaissances de Builderforce.ai versionne les procédures opérationnelles, processus et documents avec des instantanés immuables et des accusés de lecture horodatés — des preuves prêtes pour l’audit SOX, TISAX et ISO 27001 — tandis que les mêmes documents ancrent la main-d’œuvre d’agents.

![Schéma du sous-système de gestion des connaissances : une procédure versionnée avec des instantanés immuables v1/v2/v3, un suivi des accusés de lecture (acquitté, en attente, en retard) alimentant une consolidation de conformité pour SOX, TISAX et ISO 27001, une rédaction assistée par l’IA, et le même document qui ancre la main-d’œuvre d’agents](/blog/knowledge-management.svg)

## Un versionnage qui produit des preuves d’audit, pas seulement un historique

Chaque document possède un corps actif et modifiable ainsi qu’un instantané immuable pris à chaque publication. Publier incrémente le numéro de version et écrit une copie figée avec une note de modification et l’utilisateur qui a publié. Ce n’est pas un simple plus : c’est le mécanisme qui donne un *sens* aux accusés de lecture. Lorsqu’un utilisateur accuse réception d’une procédure, il accuse réception d’une version précise et figée, et l’enregistrement prouve exactement quels mots il a validés.

Republiez une procédure et les personnes qui en ont besoin sont invitées à accuser réception à nouveau. Le système suit, par utilisateur et par document, s’il est **acquitté, en attente ou en retard**, et les managers obtiennent la consolidation à `GET /api/knowledge/compliance` : nombre requis, nombre acquitté et qui est en retard. C’est la piste de preuves que demandent les auditeurs **SOX**, **TISAX** et **ISO 27001**, générée comme un effet secondaire du fait que les gens font simplement leur travail.

## Rédigez avec l’IA, améliorez avec l’IA

Une procédure vierge est la raison pour laquelle la plupart ne sont jamais écrites. L’éditeur de connaissances diffuse un premier brouillon à partir d’un prompt en langage naturel — mesuré via la passerelle LLM, rédigé en Markdown propre avec une formulation adaptée à la conformité — et vous éditez à partir de là plutôt qu’à partir de rien. Pointez l’analyseur vers une procédure existante et il renvoie des constats structurés (inefficacité, lacune, risque, clarté) avec leur gravité et un flux amélioré proposé. La documentation cesse d’être une corvée que l’on repousse pour devenir un brouillon que l’on affine.

## Écrites ensemble, en temps réel

La connaissance est une production d’équipe : l’éditeur prend donc en charge la co-édition en direct sur un transport CRDT (Yjs) : la détection de présence montre qui est dans le document, les modifications se synchronisent sous forme de deltas, et votre curseur survit au changement d’un collaborateur. Les collaborateurs par document reçoivent des rôles d’**éditeur** ou de **lecteur** par-dessus les valeurs par défaut de l’espace de travail, et les invitations notifient par Slack et par e-mail. Lorsque la collaboration en temps réel n’est pas configurée, l’éditeur bascule sur l’enregistrement automatique : aucune dépendance stricte.

## Le bénéfice : des connaissances que les agents peuvent utiliser

Voici ce qu’un wiki ne sait pas faire. Comme vos procédures et vos processus vivent sur la plateforme sur laquelle tournent vos agents, ils deviennent du **contexte pour les agents**. La procédure qui indique à un humain comment traiter un remboursement est la même procédure sur laquelle un agent ancre son travail. La documentation de conformité cesse d’être un centre de coûts que l’on entretient pour les audits et devient un actif qui rend chaque exécution — humaine ou agentique — plus juste.

[Visitez la plateforme →](/product) · [Comment fonctionne la gouvernance →](/blog/approval-gates-and-human-oversight) · [Commencez gratuitement →](/register)
