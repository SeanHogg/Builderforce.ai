# Comment lancer un cours (et téléverser du SCORM) sur Builderforce

## Qui peut rédiger un cours

La création de cours sur Builderforce est ouverte aux Creators et aux employeurs : la même vérification d’éligibilité (`resolveAuthorEligibility`) régit la création de cours et de classes. Les étudiants sont des demandeurs d’emploi en mode apprentissage ; vous n’avez pas besoin d’un compte « formateur » distinct pour publier.

Un cours est la bonne surface lorsque vous avez du contenu structuré à suivre à son rythme : un cursus d’intégration, un parcours de préparation à une certification ou un cours de compétences que vous vendez. Si vous préférez animer une classe en direct, en cohorte, avec des travaux à rendre, consultez le guide des classes : elles partagent l’infrastructure mais répondent à des besoins différents.

## Étape 1 : créer le cours et ajouter des modules

Depuis le tableau de bord Creator, ouvrez [Cours](/training) et créez un nouveau cours. Donnez-lui un titre, une description et le public visé. Ajoutez ensuite des modules : chaque module est une unité du cursus, et les modules contiennent des leçons.

Structurez le parcours avant de le remplir. Un apprenant devrait pouvoir lire votre liste de modules et comprendre l’arc : les fondamentaux, puis l’application, puis l’évaluation. L’ordre compte, car les parcours d’apprentissage prennent en charge les prérequis : les modules ultérieurs peuvent exiger les précédents.

## Étape 2 : téléverser un paquet SCORM 1.2

Si vous avez créé du contenu avec un outil comme Articulate Storyline, iSpring ou Adobe Captivate, exportez-le en paquet SCORM 1.2 (un .zip) et téléversez-le comme leçon. Builderforce intègre un environnement d’exécution SCORM 1.2, de sorte que les appels d’achèvement, de score et de signet du paquet sont capturés nativement : aucun LMS tiers n’est nécessaire.

SCORM est le bon choix quand votre contenu est interactif (scénarios à embranchements, quiz intégrés, glisser-déposer). Pour des leçons simples en vidéo ou en texte, vous n’avez pas besoin de SCORM du tout : rédigez-les directement comme leçons.

## Étape 3 : suivre l’achèvement avec le LRS xAPI

Au-delà de SCORM, Builderforce inclut un Learning Record Store xAPI. Les déclarations (« l’apprenant X a terminé l’activité Y ») sont enregistrées dans le LRS, ce qui vous donne une trace durable et interrogeable de qui a fait quoi, à travers les paquets SCORM, les leçons natives et les nœuds de parcours d’apprentissage.

C’est ce qui donne un sens à l’achèvement. Quand un apprenant termine le parcours requis, le LRS détient la preuve, ce qui est le fondement pour délivrer un certificat auquel un tiers peut réellement faire confiance.

## Étape 4 : délivrer un certificat vérifiable

À l’achèvement, Builderforce peut délivrer un certificat signé avec un HMAC afin que son authenticité puisse être vérifiée plus tard. Un titulaire partage le certificat ; un vérificateur contrôle la signature et confirme qu’il a bien été délivré pour cet apprenant et ce cours : on ne peut pas le falsifier en modifiant un PDF.

Les certificats s’intègrent aussi à la ludification : terminer une formation rapporte des points et peut débloquer des badges, ce qui garde les apprenants en mouvement dans le parcours. Publiez le cours, fixez son prix (ou rendez-le gratuit), et les apprenants s’inscrivent, progressent et obtiennent un titre qui résiste à l’examen.

## Foire aux questions

### Ai-je besoin d’un LMS externe pour héberger du SCORM ?

Non. Builderforce dispose d’un environnement d’exécution SCORM 1.2 intégré : vous téléversez votre .zip SCORM comme leçon et la plateforme capture directement l’achèvement, le score et les signets. Il existe aussi un LRS xAPI pour un suivi au niveau des déclarations sur tous les types de leçons.

### Les certificats sont-ils réellement vérifiables ?

Oui. Les certificats sont signés avec un HMAC, de sorte qu’un vérificateur peut confirmer que le certificat a bien été délivré pour un apprenant et un cours précis. Toute falsification est ainsi détectable : contrairement à un simple PDF, il ne peut pas être falsifié en modifiant le texte.

### Les employeurs peuvent-ils aussi rédiger des cours, ou seulement les Creators ?

Les deux. La création de cours et de classes partage une seule vérification d’éligibilité : Creators et employeurs peuvent donc tous deux publier. C’est ce qui permet à une entreprise de mettre en place un cursus d’intégration ou de conformité sur la même surface qu’un Creator utilise pour vendre un cours de compétences.

---

**Essayez-le :** [Cours](/training) sur Builderforce.
