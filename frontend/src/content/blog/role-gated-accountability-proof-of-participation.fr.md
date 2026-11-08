# Preuve de participation : livraison conditionnée par les rôles et rapport de responsabilité

Quand une équipe est composée d’humains et d’agents IA sur le même tableau, « qui a fait quoi » cesse d’être évident. Un ticket marqué Terminé ne vous dit rien sur le fait que les bons rôles l’ont touché — qu’un relecteur a réellement relu, qu’un spécialiste de la sécurité a jamais vu le ticket de sécurité, ou que l’agent qui a livré le code était seulement un codeur. Sur un tableau agentique rapide, cette ambiguïté est l’endroit où la qualité fuit discrètement.

Builderforce.ai fait de la participation un élément de premier ordre et démontrable.

## Le bon rôle fait le travail

La cause profonde de nombreuses mauvaises productions d’agents est une mauvaise affectation : un agent chef de produit à qui l’on confie un ticket de code, un généraliste à qui l’on confie une tâche qui exigeait un spécialiste. L’affectation tient donc désormais **compte des rôles**. Chaque agent (et chaque humain) porte une capacité de rôle de premier ordre, et une étape de production résout le rôle que le travail exige — à partir du type d’action du ticket — et envoie quelqu’un qui en est réellement capable. Un responsable incapable pour ce rôle ne peut pas être l’exécutant de repli d’une étape de production. Le cas précis où l’on envoie un manager écrire du code ne peut tout simplement plus se produire.

## Un manifeste de participation par ticket

Chaque ticket dérive un **manifeste de participation** des exigences du couloir de son tableau : les rôles dont il a besoin, chacun résolu vers un humain ou un agent capable, chacun avec un état — en attente, affecté, en cours, terminé, modifications demandées, dispensé ou non pourvu. C’est la distribution du ticket, et vous voyez d’un coup d’œil quels rôles sont couverts et lesquels ne le sont pas.

Une commande d’**évaluation des ressources** permet à un responsable d’ajouter un rôle que le modèle n’avait pas anticipé — un designer, un relecteur sécurité — et si ce rôle ne peut pas être pourvu, il apparaît comme un **déficit de ressources** bloquant plutôt que comme une omission silencieuse.

## Un rapport de responsabilité immuable

L’enregistrement lui-même est en ajout seul. `ticket_role_signoffs` consigne, par rôle : **Qui** a validé, **Quand**, son **Verdict**, ses **Commentaires** et sa **Contribution** réelle. Rien n’est modifié ni écrasé : un changement d’avis est une nouvelle entrée, pas une réécriture. La validation est conditionnée par des **permissions de refus par défaut** : seul un membre réellement capable d’un rôle peut valider en tant que ce rôle, et chaque validation écrit dans le journal d’activité unifié.

Le résultat est le **rapport de responsabilité** : une vue par rôle Qui/Quand/Verdict/Commentaires/Contribution sur le ticket, plus ses lacunes : rôles non pourvus, rôles non validés, contributions manquantes, dispenses. C’est la réponse à « cela a-t-il vraiment été bien fait ? », étayée par des preuves et non par des impressions.

## Pourquoi c’est important

Les cadres de gouvernance — SOC 2, ISO 27001 et les autres — posent sans cesse la même question : pouvez-vous *prouver* que les bonnes personnes ont fait les bonnes choses ? Sur un tableau où les agents vont vite, la réponse honnête était autrefois « plus ou moins ». La responsabilité conditionnée par les rôles la transforme en « oui, voici l’enregistrement immuable » — et comme le même manifeste qui le prouve *pilote* aussi l’affectation, vous obtenez la piste d’audit gratuitement, comme sous-produit du fait de bien faire le travail dès le départ.

La qualité est contrôlée au niveau du tableau, et non espérée après coup.

[Visitez la plateforme →](/product) · [Lisez l’article sur le Kanban de la main-d’œuvre agentique →](/blog/transitioning-to-an-agentic-workforce) · [Commencez gratuitement →](/register)
