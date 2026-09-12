Ouvrez Builderforce.ai sans être connecté, partagez un tableau, et tout fonctionne comme le partage fonctionne partout ailleurs : un lien, un bouton Copier, et vous l'envoyez à qui vous voulez. La personne l'ouvre, elle est sur votre tableau, vous modifiez tous les deux.

Créez un compte, et c'en était fini.

Le même panneau, sur un tableau que vous aviez pris la peine d'enregistrer, devenait un champ d'adresse. Saisissez un e-mail. Nous envoyons un jeton à usage unique. Le destinataire doit se connecter **avec exactement cette adresse** avant de voir quoi que ce soit — il lui faut donc un compte, il doit avoir consulté la bonne boîte de réception, et s'il s'est inscrit avec son adresse personnelle plutôt qu'avec l'adresse professionnelle que vous avez saisie, le lien l'éconduit.

Le modèle de partage du produit se dégradait précisément au moment de la transition qu'il déploie tous ses efforts à provoquer.

## N'importe quel canevas enregistré peut désormais générer un lien

```bf-figure
{
  "kind": "flow",
  "title": "D'un tableau à une autre personne qui le rejoint",
  "steps": [
    { "label": "Créer", "note": "Ouvrez le panneau d'invitation sur n'importe quel canevas enregistré, choisissez lecture, commentaire ou modification, et obtenez une URL.", "hue": "idea" },
    { "label": "Envoyer", "note": "Par le moyen que vous utilisez déjà. C'est un lien — une fenêtre de discussion, un message, une invitation d'agenda.", "hue": "make" },
    { "label": "Rejoindre", "note": "La personne voit de quel tableau il s'agit et ce qu'elle peut y faire, puis choisit : rejoindre avec un nom, se connecter ou créer un compte.", "hue": "run", "tag": "sans inscription" }
  ],
  "caption": "L'invitation par e-mail n'a pas disparu. Les deux gestes cohabitent dans le même panneau, car le bon choix dépend de ce que vous avez : l'e-mail de la personne, ou seulement une fenêtre de discussion ouverte."
}
```

Le champ d'adresse est toujours là, et il reste le bon choix pour le cas pour lequel il a été conçu : quelqu'un que vous ajoutez à l'équipe et dont vous connaissez la boîte de réception. Le lien sert à l'autre cas, qui est le plus fréquent — la personne en ligne avec vous à cet instant, le client dans un fil de discussion, l'ami dont vous voulez un deuxième avis avant le déjeuner.

```bf-figure
{
  "kind": "screen",
  "frame": "Le panneau d'invitation sur un canevas enregistré",
  "ratio": 1.5,
  "regions": [
    { "label": "Inviter par lien", "note": "Choisissez l'accès, créez le lien, copiez-le. Affiché une seule fois — seule son empreinte est stockée.", "x": 6, "y": 10, "w": 88, "h": 30, "hue": "idea" },
    { "label": "Inviter par e-mail", "note": "Inchangé. Pour la personne dont vous connaissez la boîte de réception.", "x": 6, "y": 44, "w": 88, "h": 20, "hue": "make" },
    { "label": "Membres et invitations en attente", "x": 6, "y": 68, "w": 88, "h": 16, "hue": "run" },
    { "label": "Liens actifs · révoquer", "note": "Chaque lien que vous avez créé, ce qu'il accorde, combien de fois il a été utilisé", "x": 6, "y": 86, "w": 88, "h": 10, "hue": "accent" }
  ],
  "caption": "Un seul panneau, les deux gestes. La liste des liens actifs ne contient volontairement aucune URL : seule une empreinte est stockée, donc un lien divulgué se révoque et se régénère plutôt que de se relire."
}
```

## La personne qui l'ouvre n'a pas besoin de compte

C'est la partie qui compte, et celle que l'ancien parcours ne savait pas faire du tout.

Ouvrez le lien : on vous indique à quel tableau vous êtes invité et exactement ce que vous pouvez y faire — lire, commenter ou modifier — avant que quoi que ce soit ne soit réclamé. Vous avez ensuite trois réponses possibles, et la première est *rejoindre sans compte*. Saisissez un nom. Vous êtes sur le tableau.

Pas un aperçu du tableau. **Le tableau.** Votre curseur y est, vos modifications sont enregistrées, vos commentaires portent votre nom, et la personne qui vous a invité vous voit arriver comme n'importe quel autre collaborateur. Rien n'est retenu, rien n'est une démo.

```bf-figure
{
  "kind": "compare",
  "title": "Ce qu'il faut pour consulter le tableau de quelqu'un",
  "columns": [
    { "title": "Avant", "hue": "muted", "items": ["Qu'on vous demande votre adresse e-mail", "Attendre le message", "Le retrouver", "Créer un compte", "Vérifier l'adresse", "Se connecter avec exactement cette adresse", "Enfin voir le tableau"] },
    { "title": "Maintenant", "hue": "run", "items": ["Ouvrir le lien", "Saisir un nom", "Vous êtes sur le tableau"] }
  ],
  "caption": "Les deux colonnes aboutissent au même accès. L'une d'elles y parvient en quatre secondes environ."
}
```

Le fait qu'il s'agisse d'une vraie identité, et non d'un simple laissez-passer de consultation, entraîne plusieurs conséquences :

- **Cela ne coûte rien de facturable à l'espace de travail.** Un collaborateur de canevas n'a jamais été un siège payant, et un invité par lien en fait partie. Ce qui l'encadre, c'est la limite de collaborateurs que l'offre affiche déjà.
- **Un lien accorde la lecture, le commentaire ou la modification, et rien de plus.** Il ne peut jamais accorder les deux rôles qu'il serait dangereux de transférer : l'exécution d'agents (qui consomme les jetons de l'espace de travail) et la propriété (qui permet de céder le tableau). Ce ne sont pas des options qu'une URL a le droit d'exprimer.
- **L'accès que vous avez donné au tableau plafonne tout le reste.** Une personne invitée à commenter ne peut pas modifier l'espace de travail qui l'entoure.
- **Vous pouvez créer un compte plus tard.** Ouvrez le même lien une fois connecté : il y installe le compte que vous venez de créer, sur le même tableau, avec le même accès.

Et il se révoque comme un lien devrait se révoquer : chaque lien que vous avez créé est listé dans le même panneau, avec ce qu'il accorde, le nombre de personnes qui l'ont utilisé et un bouton pour le désactiver.

## Sa place dans la méthode

**Lire** et **Prouver** sont les deux premiers actes, et ce sont les moins coûteux — délibérément, pour que la décision de construire soit une décision et non un réflexe par défaut. Mais tous deux se font *avec d'autres personnes*. Lire le paysage, c'est demander à quelqu'un qui le connaît de regarder ce que vous avez trouvé. Prouver, c'est placer la version la plus aiguisée de l'idée devant la personne la plus susceptible de vous dire qu'elle est fausse.

Ce qui tue cela, ce n'est ni la lecture ni la preuve. C'est l'invitation.

```bf-figure
{
  "kind": "compare",
  "title": "Qui voit réellement le tableau",
  "columns": [
    { "title": "Quand l'invitation exige un compte", "hue": "muted", "items": ["Les deux personnes déjà dans l'espace de travail", "Quiconque acceptera de créer un compte pour vous rendre service", "Personne de pressé", "Personne que vous avez rencontré il y a dix minutes"] },
    { "title": "Quand c'est un lien", "hue": "idea", "items": ["La personne en ligne avec vous", "Le client dans le fil de discussion", "L'expert du domaine qui vous doit vingt minutes", "Le client à qui vous devez le prouver"] }
  ],
  "caption": "L'étape Prouver ne vaut que ce que vaut la personne à qui vous la montrez. Une invitation qui coûte une inscription sélectionne la patience, pas le discernement."
}
```

Chaque inscription que vous imposez à un relecteur est un filtre, et il filtre la mauvaise chose : il garde ceux qui vous apprécient déjà et perd ceux dont l'avis aurait changé l'idée. Le tableau est l'endroit où une idée devient quelque chose dont on peut débattre. Il devrait être accessible à toute personne à qui vous pouvez envoyer un lien.

## Ce que vous pouvez en faire dès aujourd'hui

- **Partager n'importe quel canevas enregistré par une URL** — choisissez lecture, commentaire ou modification, copiez, envoyez.
- **Laisser quelqu'un rejoindre en saisissant un nom** — sans inscription, sans mot de passe, un vrai collaborateur sur votre tableau.
- **Inviter par e-mail comme avant** quand vous connaissez l'adresse et voulez intégrer la personne à l'équipe.
- **Révoquer n'importe quel lien** depuis le même panneau, à tout moment, sans toucher à ceux qui ont déjà rejoint.
- **Transformer un invité en compte plus tard** — créez-en un et ouvrez le même lien pour conserver l'accès.

---

**À lire aussi :** [Créez avant de vous inscrire](/blog/create-before-you-sign-up) · [Le multijoueur sur le canevas, dans le navigateur et dans VS Code](/blog/multiplayer-creation-canvas-web-vscode) · [Le Canvas de création n'est pas une fenêtre de chat](/blog/creation-canvas-beyond-chat)

[Ouvrez un canevas](/create) et envoyez le lien à quelqu'un.
