Une conversation avec une équipe d’agents pose deux questions à chaque tour. **À qui est-ce que je parle ?** Et **qui me répond ?**

La première a un réglage depuis un moment. « À » dans la zone de saisie, ou une @-mention, envoie un message à un agent invité ou à un coéquipier plutôt qu’au Brain. La seconde n’existait que sur le web. Là, « En tant que » permettait de faire répondre le Brain en tant que constructeur de sites, développeur mobile ou enseignant Evermind, ou en tant que l’un des agents attribués à votre espace de travail. Dans VS Code, là où l’essentiel se construit, vous aviez l’assistant par défaut, à chaque fois.

Cet écart est comblé.

## En tant que, dans votre éditeur

La zone de saisie de l’éditeur porte désormais les deux mêmes réglages que le web, côte à côte.

```bf-figure
{
  "kind": "screen",
  "frame": "La zone de saisie du chat dans VS Code",
  "ratio": 2.2,
  "regions": [
    { "label": "Votre message", "note": "Saisi comme avant ; une @-mention l’oriente toujours", "x": 3, "y": 8, "w": 94, "h": 46, "hue": "muted" },
    { "label": "En tant que", "note": "Brain par défaut · une persona · un agent attribué", "x": 3, "y": 62, "w": 30, "h": 30, "hue": "idea" },
    { "label": "À", "note": "Le Brain · un agent invité · un coéquipier", "x": 36, "y": 62, "w": 26, "h": 30, "hue": "make" },
    { "label": "+ · / · Envoyer", "x": 65, "y": 62, "w": 32, "h": 30, "hue": "accent" }
  ],
  "caption": "Les deux mêmes sélecteurs que dans la zone de saisie web : les deux surfaces proposent les mêmes choix et les nomment de la même façon."
}
```

« En tant que » propose trois sortes de réponse :

- **Le Brain par défaut** — votre assistant de code, ancré dans l’espace de travail ouvert.
- **Une persona** — Site web, Mobile, Web + Mobile, Evermind, Réglage fin ou Voix. Ce sont les personas du constructeur web : la persona Mobile écrit du React Native avec des zones tactiles de 44 points et des marges de sécurité, et la persona Evermind enseigne au lieu d’entraîner.
- **Un agent attribué au Brain** — n’importe lequel. Le Brain répond dans le rôle et avec la voix de cet agent, et s’exécute sur le modèle propre de l’agent, sauf si vous avez épinglé un modèle dans le menu `/`.

## La persona se pose sur votre espace de travail

Une chose fonctionne différemment dans l’éditeur, volontairement. Sur le web, une persona *est* l’instruction du Brain, parce qu’il n’y a rien d’autre à décrire. Dans l’éditeur, le Brain sait déjà des choses réelles : quel dossier est ouvert, quel fichier vous regardez, quels outils peuvent toucher votre dépôt. Une persona Site web qui promet « l’aperçu est en direct » ne doit rien écraser de tout cela.

Dans VS Code, la persona s’ajoute donc par-dessus.

```bf-figure
{
  "kind": "compare",
  "title": "Ce qu’une persona change, et ce qu’elle laisse tel quel",
  "columns": [
    { "title": "Sur le web", "hue": "muted", "items": ["La persona est toute l’instruction", "Son monde est le constructeur dans le navigateur : aperçu, publication, serveur de développement", "Choisissez Mobile et elle construit pour le simulateur d’appareil"] },
    { "title": "Dans votre éditeur", "hue": "make", "items": ["La persona s’ajoute à ce que l’éditeur sait déjà", "Votre dossier ouvert, votre fichier et votre dépôt restent son monde", "Choisissez Mobile et elle construit du React Native, dans vos fichiers"] }
  ],
  "caption": "Une persona change la façon dont le Brain construit. Elle ne change jamais l’endroit où le Brain croit que vit votre code."
}
```

## Une question à tout le tableau montre à qui elle a été posée

Posez une question à un canevas sans @-mentionner personne, et chaque agent du tableau répond. Les réponses ont toujours porté leur auteur. La question, non : ouverte sur la page du chat, elle semblait adressée à personne en particulier.

```bf-figure
{
  "kind": "flow",
  "title": "Une question posée à tout le tableau",
  "steps": [
    { "label": "Demander", "note": "Aucune @-mention : la question va à chaque agent du canevas", "hue": "idea" },
    { "label": "Adressée", "note": "La question garde le nom de chaque agent à qui elle a été posée", "hue": "make" },
    { "label": "Répondue", "note": "Chaque agent répond en son nom ; le Brain reste en dehors", "hue": "make", "tag": "web et éditeur" }
  ],
  "caption": "Une question à trois destinataires les affiche désormais tous les trois, et c’est à eux d’y répondre : le Brain ne la reprend jamais, même si l’un d’eux ne répond pas."
}
```

## Où cela se situe dans la méthode

[Lire, Prouver, Construire](/blog/read-prove-build-the-inner-loop) est une boucle qui porte sur *qui fait le travail*, pas seulement sur le travail lui-même. Lire un marché est un autre métier que prouver un prix, et les deux diffèrent de la construction de l’écran qui le vend. Jusqu’ici, l’éditeur vous laissait choisir à qui vous parliez. Il ne vous laissait pas choisir qui répondait, si bien que chaque acte de la boucle passait par le même généraliste.

Choisir qui répond compte surtout dans **Make**, l’étape de l’[arc](/blog/idea-to-real-the-operating-methodology) où Construire est l’acte coûteux. C’est là que la différence entre « un assistant » et « le développeur mobile » se paie en reprises : des zones tactiles qui n’ont jamais fait 44 points, une mise en page qui supposait un survol. Choisir la persona avant la première ligne coûte moins cher que la corriger après. Plus tôt dans l’arc, faire répondre le Brain en tant que l’agent attribué à la stratégie fait venir la lecture et la preuve du rôle que vous auriez de toute façon consulté.

## Ce que vous pouvez en faire aujourd’hui

- **Lancer un tour en tant que spécialiste, dans votre éditeur** — Site web, Mobile, Web + Mobile, Evermind, Réglage fin ou Voix — sans quitter vos fichiers.
- **Répondre en tant que l’un de vos agents**, sur le modèle propre de cet agent, depuis la zone de saisie où vous tapez déjà.
- **Adresser un message à un coéquipier ou à un agent invité** avec le même réglage « À » sur le web et dans VS Code.
- **Voir tous ceux à qui une question a été posée** quand vous interrogez tout le tableau d’un coup.

---

**À lire aussi :** [Chat d’équipe multipartite](/blog/multi-party-team-chat-humans-and-agents) · [Des personas psychométriques pour les agents](/blog/ai-agent-personality-psychometric-personas) · [Lire, Prouver, Construire](/blog/read-prove-build-the-inner-loop)

[Ouvrez Brain Storm](/brainstorm) et choisissez qui répond.
