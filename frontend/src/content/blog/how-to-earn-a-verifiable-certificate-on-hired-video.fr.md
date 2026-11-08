# Comment obtenir un certificat vérifiable sur Builderforce (et prouver qu’il est authentique)

## Pourquoi « vérifiable » est le mot qui compte

N’importe qui peut fabriquer un certificat dans un traitement de texte. Le problème n’est pas d’en produire un, c’est de faire en sorte qu’un employeur y croie. Un certificat vérifiable résout précisément cela : il porte une signature cryptographique qui permet à un tiers de confirmer qu’il a bien été délivré, à votre nom, pour ce cours précis, et qu’il n’a pas été altéré.

Builderforce signe chaque certificat avec un HMAC. C’est ce qui sépare un titre auquel un responsable du recrutement fera confiance d’un PDF que n’importe qui pourrait falsifier.

## Étape 1 : terminer le parcours requis

Inscrivez-vous à un [cours](/training) ou à un parcours d’apprentissage et terminez ce qu’il exige. L’achèvement n’est pas une case que l’on coche soi-même : votre progression est enregistrée au fur et à mesure dans le Learning Record Store xAPI de la plateforme, y compris les résultats des leçons SCORM et les nœuds du parcours d’apprentissage.

Si le parcours comporte des prérequis, les modules précédents débloquent les suivants : vous les terminez donc dans l’ordre. Lorsque le LRS a enregistré que vous avez satisfait aux exigences, vous êtes éligible au certificat.

## Étape 2 : recevoir le certificat signé

À l’achèvement, Builderforce délivre votre certificat signé avec un HMAC. La signature est liée à votre identité et au cours précis : modifiez un seul caractère du contenu du certificat et la signature ne correspond plus.

L’obtenir alimente aussi la ludification : terminer une formation rapporte des points et peut débloquer des badges, de sorte que le titre est l’une de plusieurs récompenses pour avoir terminé.

## Étape 3 : le partager pour qu’un employeur puisse le vérifier

Lorsque vous partagez le certificat, le destinataire peut le soumettre à la vérification : le vérificateur recalcule la signature sur le contenu du certificat et confirme qu’elle correspond à ce que Builderforce a délivré. Un certificat authentique réussit ; un certificat falsifié ou fabriqué échoue.

C’est tout l’intérêt. Vous ne demandez pas à l’employeur de vous croire sur parole : vous lui remettez quelque chose qu’il peut contrôler de façon indépendante en quelques secondes. Ajoutez le lien sur votre profil, joignez-le à une candidature ou envoyez-le directement à un responsable du recrutement.

## Foire aux questions

### Qu’est-ce qui rend le certificat « vérifiable » plutôt que simple PDF ?

Il est signé avec un HMAC. Un vérificateur recalcule la signature sur le contenu du certificat et la compare à ce que Builderforce a délivré. Si quoi que ce soit a été altéré — le nom, le cours, la date —, la signature ne correspondra pas : toute falsification est donc détectable.

### Comment la plateforme sait-elle que j’ai réellement terminé le cours ?

Votre progression est enregistrée dans un Learning Record Store xAPI à mesure que vous avancez dans les leçons, les paquets SCORM et les nœuds du parcours d’apprentissage. Le certificat est délivré sur la base de ces enregistrements, et non d’une case cochée par vos soins.

### Puis-je mettre le certificat sur mon profil ?

Oui. Vous pouvez le faire apparaître sur votre profil, le joindre à vos candidatures ou envoyer le lien vérifiable directement à un employeur, qui peut en confirmer l’authenticité de manière indépendante.

---

**Essayez-le :** [Cours](/training) sur Builderforce.
