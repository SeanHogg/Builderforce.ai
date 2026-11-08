# Menez un bloc de présélection en direct de 30 minutes et remplacez deux semaines d’appels téléphoniques

## Pourquoi l’enchaînement l’emporte sur l’asynchrone

Les CV vidéo asynchrones ont leur place : ils permettent de présélectionner 100 candidats en une soirée. Mais pour les candidats déjà dans votre présélection, la présélection asynchrone perd trois choses que la présélection synchrone conserve :

1. **Les questions de suivi en temps réel.** On ne peut pas demander à une réponse enregistrée de préciser.
2. **La perception de l’énergie et de l’adéquation culturelle.** L’asynchrone supprime au montage les moments qui vous disent si vous voudriez réellement travailler avec quelqu’un.
3. **La rapidité de décision.** Les boucles uniquement asynchrones ajoutent 3 à 5 jours par tour ; les blocs enchaînés permettent de décider le jour même.

ZipIntro de ZipRecruiter est le produit de référence en la matière. Les sessions de présélection en direct de Builderforce sont le même flux de travail pour une fraction du coût, et elles s’intègrent aux résultats de l’agent recruteur IA v2 de l’article précédent.

## Étape 1 : déclarer votre plage

Appelez `POST /api/recruiter/live-screen/sessions` avec la plage :

```json
{
  "title": "Staff Backend Engineer first-rounds",
  "jobId": "<uuid>",
  "startTime": "2026-06-03T13:00:00Z",
  "endTime": "2026-06-03T15:00:00Z",
  "slotMinutes": 15,
  "meetingUrl": "https://meet.google.com/abc-defg-hij"
}
```

La session est conservée dans `live_screening_sessions` avec le statut `scheduled`. La plage est de 2 heures ; avec des créneaux de 15 minutes, cela fait une capacité de 8 candidats. Vous pouvez choisir n’importe quelle durée de créneau entre 3 et 60 minutes : la plupart des recruteurs retiennent 8 minutes pour une présélection et 15 pour des premiers tours plus approfondis.

## Étape 2 : planifier vos candidats

Envoyez votre liste de candidats par POST à `/sessions/:id/schedule` :

```json
{
  "candidates": [
    { "candidateId": "…", "candidateName": "Alice Chen", "candidateEmail": "alice@example.com" },
    { "candidateId": "…", "candidateName": "Bob Park", "candidateEmail": "bob@example.com" }
  ]
}
```

La fonction pure `buildBackToBackSchedule` découpe votre plage en créneaux enchaînés et leur associe les N premiers candidats. La réponse vous indique la capacité, combien ont été planifiés et lesquels (le cas échéant) ont débordé : utile lorsque vous avez présélectionné plus de candidats que votre plage n’en contient.

Chaque invitation reçoit un `invite_token` imprévisible de 32 octets. Envoyez au candidat, par e-mail ou SMS, le lien vers `https://Builderforce/live-screen/invite/{token}` : il n’a pas besoin de compte Builderforce pour répondre.

## Étape 3 : le candidat accepte (ou décline)

Lorsque le candidat visite l’URL de son invitation, il voit l’horaire du créneau et le titre de la session. Il peut accepter ou décliner en un clic. Les points d’accès publics — `GET /api/live-screen/invites/:token` et `POST /api/live-screen/invites/:token/respond` — ne nécessitent aucune authentification : le lien fonctionne donc depuis n’importe quelle boîte de réception.

L’URL de la réunion n’est **révélée qu’après l’acceptation du candidat**. Cela évite les fuites par partage d’URL et vous donne un indicateur propre du taux d’acceptation : les candidats qui ont décliné n’ont jamais vu le lien de la réunion.

Sur votre tableau de bord, regardez la liste des invitations passer de `pending` à `accepted` / `declined` à mesure que les candidats répondent. La plupart des invitations reçoivent une réponse dans les 24 heures ; celles qui n’en reçoivent pas peuvent être relancées ou remplacées avant le début de la plage.

## Déroulement le jour J

**H-30 minutes.** Ouvrez la vue détaillée de la session. Vérifiez que le nombre d’invitations acceptées correspond à vos attentes. Relancez une dernière fois les personnes qui n’ont pas répondu.

**H-0.** Ouvrez l’URL de la réunion. Le candidat 1 se connecte pour 15 minutes. Vous posez 2 à 3 questions, prenez des notes dans votre tableau de bord. À H+15, le candidat 1 part et le candidat 2 se connecte : même salle, même URL, à la suite.

**Fin de session.** Après le départ du dernier candidat, faites passer le statut de la session à `completed`. Marquez éventuellement `no_show` sur toute invitation sans présentation. Faites passer les 2 ou 3 meilleurs au tour suivant par le pipeline habituel.

Un bloc de 2 heures permet d’interroger 8 candidats à raison de 15 minutes chacun. Cela représentait autrefois deux semaines de « trouvons un horaire qui convienne ». Maintenant, c’est un mardi après-midi.

## Retour sur investissement face à la planification par ping-pong téléphonique

**Le flux du ping-pong téléphonique :** 8 candidats × (3 e-mails + 1 report + appel de 30 min + 5 min de clôture) = environ 4,5 heures de temps de recruteur + 14 jours calendaires entre « intéressé » et « décision ».

**Le flux de présélection en direct :** 8 candidats × (1 invitation + créneau de 15 min) = environ 2,5 heures de temps de recruteur + 3 jours calendaires.

Temps économisé pour 8 candidats : **2 heures de travail de recruteur + 11 jours de délai**. Le délai compte plus que les heures du recruteur : le candidat qui a trois propositions en cours acceptera l’entreprise qui avance le plus vite. Les blocs de présélection en direct font du délai votre avantage concurrentiel.

## Foire aux questions

### Les candidats ont-ils besoin d’un compte Builderforce pour accepter une invitation ?

Non. Le flux d’acceptation / de refus est entièrement à jeton : l’URL d’invitation contient un jeton imprévisible de 32 octets, et les points d’accès publics ne nécessitent pas d’authentification. Le candidat peut répondre depuis n’importe quel appareil, n’importe quelle boîte de réception, en un clic.

### Builderforce fournit-il la salle vidéo ?

Pas dans cette version. Vous fournissez l’URL de la réunion (Zoom, Meet, Whereby) et Builderforce gère l’appariement, la planification, les invitations, le flux d’acceptation et les rappels. Une salle WebRTC native figure sur la feuille de route (registre des écarts n° 1210), mais les salles externes fonctionnent bien aujourd’hui et vous permettent de réutiliser vos outils existants.

### Puis-je apparier automatiquement des candidats issus d’une exécution précédente de l’agent ?

L’appariement automatique dans une session à partir d’une exécution d’agent enregistrée figure sur la feuille de route (registre des écarts n° 1208). Aujourd’hui, vous envoyez la liste de candidats explicitement par POST. Le schéma le plus courant : lancer l’agent recruteur IA (les 8 premiers par score), copier ces identifiants dans le corps de `/schedule`, envoyer. Deux minutes de bout en bout.

---

**Essayez-le :** [Sessions de présélection en direct](/hires) sur Builderforce.
