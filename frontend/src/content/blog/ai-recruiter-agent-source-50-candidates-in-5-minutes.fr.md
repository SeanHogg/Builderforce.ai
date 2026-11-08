# Sourcez 50 candidats en 5 minutes : le guide de l’agent recruteur IA v2

## L’ancien flux de travail face au flux de l’agent

**L’ancien flux.** Vous écrivez une recherche booléenne à la main. Vous faites défiler 200 profils. Vous en présélectionnez 15. Vous rédigez manuellement un message d’approche pour chacun. Vous programmez un rappel pour relancer dans trois jours, un autre dans sept. Vous oubliez le second. La moitié de vos candidats n’ont jamais de nouvelles. Tout le processus prend deux heures pour un poste.

**Le flux de l’agent.** Vous collez un brief en langage courant — « recrutement d’un ingénieur infrastructure senior staff avec une solide expérience de Go et Kubernetes pour une fintech de série C à New York, 7 ans et plus » — et l’agent renvoie une liste classée de candidats, une approche personnalisée pour chacun et une séquence de relances planifiée. Cinq minutes, un poste.

L’agent recruteur IA ne remplace pas votre jugement : il supprime les frappes au clavier entre votre jugement et le message envoyé.

## Étape 1 : Prise en charge (brief → critères structurés)

Appelez `POST /api/recruiter/agent/intake` avec `{ briefText: "…" }`. L’agent analyse le brief et renvoie des critères structurés :

```json
{
  "jobTitle": "Senior Staff Infrastructure Engineer",
  "skills": ["go", "kubernetes", "terraform"],
  "location": "New York, NY",
  "experienceYears": 7,
  "maxCandidates": 20,
  "source": "brief"
}
```

Ou, si vous avez déjà une offre d’emploi, transmettez `{ jobId: "<uuid>" }` et l’agent en dérive la même structure à partir de la ligne de l’offre — intitulé, compétences, lieu, avec l’expérience déduite de la description.

Cette étape de prise en charge est ce que LinkedIn commercialise sous le nom de Semantic Sourcing : au lieu de saisir `(go OR golang) AND kubernetes AND "New York"`, vous décrivez le poste en langage naturel. L’agent fonctionne en mode purement heuristique lorsqu’aucune clé LLM n’est configurée : la surface renvoie donc toujours une structure de critères exploitable, utile en développement local et pour une dégradation en douceur lorsque le fournisseur de modèle est indisponible.

## Étape 2 : Sourcing (critères → candidats classés + brouillons d’approche)

Transmettez la réponse de la prise en charge à `POST /api/recruiter/agent/source`. L’agent fait trois choses en un seul aller-retour :

1. **Il source** — il rapproche par mots-clés les candidats de la base de CV avec les compétences des critères.
2. **Il note** — il passe chaque candidat au LLM avec le contexte du poste, et renvoie un score d’adéquation de 0 à 100 accompagné d’une raison en une phrase.
3. **Il rédige l’approche** — pour chaque candidat, il génère une approche LinkedIn / e-mail personnalisée de trois phrases, qui fait référence au parcours réel du candidat, pas à un modèle générique.

L’exécution est conservée dans `recruiter_agent_runs`, ce qui permet d’y revenir plus tard via `GET /api/recruiter/agent/runs/:id`. Les résultats sont triés par score décroissant : examinez les 10 premiers, écartez ceux qui ne conviennent pas et passez à l’étape 3 pour les autres.

## Étape 3 : Planifier les relances (cadence persistante)

Les relances manuelles sont l’endroit où 90 % des flux de recrutement perdent des candidats. Le troisième super-pouvoir de l’agent est de les rendre persistantes.

Pour chaque candidat à relancer, appelez `POST /api/recruiter/agent/followups/schedule` avec `{ runId, candidateId, dayOffset, body }`. Les valeurs par défaut sont 3 jours pour la première relance, 7 pour la deuxième, 14 pour la dernière. Personnalisez le texte ou utilisez le brouillon généré par l’IA.

Un worker cron (`recruiter-agent-followup`, exécuté toutes les 5 minutes) fait passer les lignes arrivées à échéance de `pending` à `sent`, en matérialisant le rappel dans votre flux `candidate_interactions` pour que vous le voyiez dans votre tableau de bord dès que le créneau arrive. Annulez toute relance planifiée avec `POST /api/recruiter/agent/followups/:id/cancel` si le candidat a déjà répondu.

C’est la partie que LinkedIn Hiring Assistant facture plusieurs milliers de dollars par siège. Sur Builderforce, elle fait partie du forfait Pro sans supplément par siège — la [page des tarifs](/pricing) indique le tarif en vigueur.

## Calcul du retour sur investissement : ce que 5 minutes font économiser par poste

Estimations prudentes pour un recruteur qui source un poste par jour, 20 jours ouvrés par mois :

- **Flux manuel :** environ 2 heures par poste × 20 postes = **40 heures par mois** de sourcing + approche + relances.
- **Flux de l’agent :** environ 5 minutes par poste × 20 postes = **100 minutes par mois** pour le même flux.
- **Temps récupéré : environ 38 heures par mois** à consacrer aux entretiens, à la conclusion et à la gestion d’équipe plutôt qu’aux frappes au clavier.

Les clients LinkedIn Charter qui utilisent Hiring Assistant déclarent 62 % de profils en moins à examiner, plus de 4 heures économisées par poste et 69 % d’acceptation d’InMail en plus. L’agent de Builderforce exécute la même boucle au sein du forfait Pro, sans frais supplémentaires de type Hiring Assistant.

Le retour sur investissement caché est la cadence de relance. La plupart des recruteurs perdent plus de candidats en oubliant de relancer qu’à cause de candidats qui déclinent. Les relances planifiées vous offrent en pratique +30 % en haut de l’entonnoir sans envoyer une seule approche supplémentaire.

## Foire aux questions

### L’agent recruteur IA envoie-t-il automatiquement l’approche ?

Pas encore : l’agent matérialise actuellement le message sous forme de brouillon dans votre flux d’interactions avec les candidats, et vous l’envoyez via le canal de votre choix (e-mail, LinkedIn, SMS). L’envoi automatique via le Comm Hub figure sur la feuille de route (registre des écarts n° 1206) ; l’architecture actuelle garde délibérément le recruteur dans la boucle afin qu’une hallucination du LLM ne puisse pas contacter un candidat sans relecture.

### Que se passe-t-il quand le fournisseur de LLM est indisponible ?

Le point d’entrée de prise en charge bascule sur une heuristique déterministe qui extrait le poste, les compétences (par correspondance avec un dictionnaire), le lieu et les années d’expérience du brief. Le point d’entrée de sourcing bascule sur un score de base plus une approche modèle pour chaque candidat. La surface se dégrade, elle ne renvoie jamais d’erreur.

### En quoi est-ce différent d’une recherche booléenne ?

Une recherche booléenne renvoie tous ceux qui correspondent aux mots-clés. L’agent les classe selon une adéquation dérivée du LLM, rédige une approche personnalisée pour chacun et planifie les relances : les trois étapes qui transforment une recherche en recrutement. Vous pouvez toujours écrire des recherches booléennes ; l’agent s’y superpose.

---

**Essayez-le :** [Agent recruteur IA](/hires) sur Builderforce.
