# Votre piste d'audit peut enfin quitter la plateforme

Les traces des exécutions d'agents partaient déjà vers votre propre collecteur OpenTelemetry — Honeycomb, Datadog, Grafana, peu importe. Votre piste d'audit, non. Connexions, changements de rôle, clés API, décisions d'approbation, appels d'outils d'agents : tout était enregistré, rien n'était exportable. Une équipe sécurité avec un SIEM voyait le travail des agents comme une île — et la piste d'audit comme une seconde.

Les deux îles sont maintenant reliées. Tout exportateur OpenTelemetry peut aussi envoyer les événements d'audit comme logs OTLP vers le point de terminaison `/v1/logs` de votre collecteur.

## Choisissez vos signaux

Un exportateur indique désormais quels signaux il envoie :

- **Traces seulement** — exactement ce que faisaient les exportateurs avant. Rien ne change pour les lignes existantes.
- **Audit seulement** — la piste de sécurité part vers votre SIEM ; les traces d'exécution restent dans le produit.
- **Les deux** — un collecteur, deux signaux. Les traces vont vers `/v1/traces`, les journaux d'audit vers `/v1/logs`.

## L'ensemble des événements

Le balayage couvre la surface de sécurité qu'un réviseur interroge : connexions et sessions, changements de rôle et d'appartenance, changements de clés API, exports, connexions d'intégration, décisions d'approbation et appels d'outils d'agents.

Deux propriétés comptent plus que la liste elle-même. La livraison est au-moins-une-fois avec l'id de chaque événement comme clé de déduplication, et un curseur par source signifie qu'un lot échoué est réessayé exactement là où il s'est arrêté — sans perte, sans doublon. Et une panne du collecteur ne ralentit jamais une requête : le balayage tourne en arrière-plan, et dès qu'un collecteur échoue, la ligne de l'exportateur dans les réglages le dit, sur la même ligne de santé qui affichait déjà la livraison des traces.

## La limite

L'export d'un espace de travail ne porte que ses propres événements. La piste opérateur — le `admin_audit_log` transverse — n'est jamais exportée vers un espace de travail. Votre SIEM voit votre espace, pas celui des autres.

Configurez-le dans **Réglages → Intégrations → Export OpenTelemetry**.
