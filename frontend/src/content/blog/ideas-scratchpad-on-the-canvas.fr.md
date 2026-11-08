# Notez l’idée avant qu’elle ne disparaisse — et sachez lesquelles vous avez réellement testées

La plupart des idées ne meurent pas parce qu’elles étaient mauvaises. Elles meurent dans une application de notes.

Vous en avez une sous la douche, en marchant, au milieu d’un appel sur autre chose. Vous l’écrivez quelque part — application de notes, dos d’un ticket de caisse, message Slack envoyé à vous-même — et elle y reste avec quarante autres, aucune plus avancée que le jour où vous l’avez eue. Six mois plus tard, vous ne pouvez pas dire lesquelles vous avez un jour testées avec un vrai client, et lesquelles vous avez seulement *aimées*.

Le canevas avait le problème inverse. Il pouvait contenir un segment de clientèle étudié, une fiche concurrentielle, un entretien client et une expérience notée. Il n’avait nulle part où poser la pensée à peine formée qui avait déclenché tout cela.

## Le bloc-notes d’idées

Chaque canevas dispose désormais d’une quatrième manière de lire le tableau, juste à côté de Tableau : **Idées**.

```bf-figure
{
  "kind": "screen",
  "frame": "Le bloc-notes d’idées sur un canevas",
  "ratio": 1.62,
  "regions": [
    { "label": "Capturer", "note": "Tapez la pensée, appuyez sur Capturer : la première ligne devient son titre, la note entière est conservée", "x": 4, "y": 8, "w": 92, "h": 20, "hue": "idea" },
    { "label": "Étapes", "note": "Combien d’idées se trouvent à chaque étape ; appuyez sur l’une pour filtrer", "x": 4, "y": 32, "w": 26, "h": 60, "hue": "accent" },
    { "label": "Vos idées", "note": "Les plus récentes d’abord, chacune avec son étape, sa prochaine action et ses preuves", "x": 33, "y": 32, "w": 63, "h": 60, "hue": "make" }
  ],
  "caption": "Le bloc-notes est une lecture du tableau, pas un second endroit où ranger les choses. Chaque idée capturée est une carte du tableau : Brain la voit et vous pouvez la faire glisser à côté du travail dans lequel elle se transforme."
}
```

Noter une idée prend à peu près autant de temps que d’en avoir une. Tapez une phrase, ou trois, et appuyez sur **Capturer**. La première ligne devient le titre de l’idée et la note entière est conservée exactement comme vous l’avez écrite. L’idée à peine formée est le but : un bloc-notes qui exige un énoncé de problème avant d’accepter une note est un formulaire, et la note se perd.

Ensuite, le bloc-notes assure le suivi à votre place. Chaque idée a une étape, et ces étapes sont celles que traverse réellement une idée :

```bf-figure
{
  "kind": "flow",
  "title": "La vie d’une idée",
  "steps": [
    { "label": "Capturée", "note": "Écrite. On n’exige rien de plus d’elle.", "hue": "idea" },
    { "label": "En exploration", "note": "En cours d’étude : le problème, qui l’a, qui d’autre cherche à le résoudre.", "hue": "idea" },
    { "label": "En validation", "note": "Un entretien client ou une expérience est en cours.", "hue": "make" },
    { "label": "Validée", "note": "Les preuves sont revenues positives.", "hue": "run", "tag": "méritée, pas ressentie" }
  ],
  "caption": "Trois autres étapes sont des sorties, et chacune signifie quelque chose de différent un mois plus tard : Mise de côté veut dire « pas maintenant », Abandonnée « les preuves ont dit non », et Promue « elle est devenue quelque chose » — un projet, une entreprise, une preuve."
}
```

## Où interviennent les entretiens clients

Une idée ne vaut que par les conversations qui la sous-tendent : chaque idée du bloc-notes a donc un bouton **Planifier un entretien**. Appuyez dessus et trois choses se produisent en même temps : une carte d’entretien client arrive sur le tableau, titrée d’après l’idée ; l’idée enregistre que cet entretien la teste ; et une idée qui n’était que capturée ou en exploration passe en validation.

Quand l’entretien est rédigé — les questions, les difficultés que la personne a soulevées sans qu’on les lui demande, les citations textuelles — l’idée le compte. Chaque idée affiche ses preuves en termes clairs : *testée par 2 entretiens et 1 expérience*, ou *non testée — parlez à quelqu’un avant de construire*. Si une idée nomme un entretien qui n’est pas sur le tableau, elle l’indique au lieu de le compter.

Et en haut du bloc-notes figure le seul chiffre qui mérite qu’on agisse : combien de vos idées ouvertes n’ont encore été testées par personne auprès d’un client.

```bf-figure
{
  "kind": "compare",
  "title": "Garder des idées ou les suivre",
  "columns": [
    { "title": "Une application de notes", "hue": "muted", "items": ["Quarante idées, toutes dans le même état", "Aucune trace de qui vous avez interrogé", "« Validée » veut dire qu’elle plaît toujours", "Commencer le travail veut dire la recopier ailleurs"] },
    { "title": "Le bloc-notes d’idées", "hue": "idea", "items": ["Chaque idée a une étape", "Entretiens et expériences reliés à l’idée qu’ils testent", "Validée veut dire que les preuves ont dit oui", "L’idée est déjà une carte du tableau, là où le travail se fait"] }
  ],
  "caption": "La différence ne tient pas à l’endroit où les mots sont stockés. Elle tient à ce que « avons-nous parlé à quelqu’un de cela ? » ait une réponse."
}
```

## Sa place dans la méthode

De l’idée au réel suit **Idée → Réaliser → Exécuter → Mesurer**, et le premier acte est le moins coûteux volontairement : [Lire et Prouver](/blog/read-prove-build-the-inner-loop) viennent avant Construire, afin que décider de construire soit une décision et non de l’élan.

Le bloc-notes est la porte d’entrée de ce premier acte. **Capturer** est le moment avant Lire : l’idée doit exister quelque part avant que quiconque puisse l’étudier. **Explorer** est Lire : Brain peut prendre n’importe quelle idée du tableau et étudier le problème, le segment et la concurrence qui l’entourent. **Valider** est Prouver : l’entretien client ou l’expérience qui transforme une hypothèse en fait, et la moins coûteuse des [huit façons de rendre une idée réelle](/blog/eight-ways-to-make-an-idea-real). Seule une idée qui est passée par les deux devrait être **Promue** en quelque chose que vous construisez.

Cette étape en avait besoin parce que c’était le seul endroit où la méthode n’avait aucun objet. Tout ce qui venait ensuite en avait un : preuves, projets, versions, indicateurs. L’idée elle-même vivait dans l’application que vous aviez ouverte au moment où vous l’aviez eue.

## Ce que vous pouvez en faire dès aujourd’hui

- **Capturer une idée en quelques secondes** depuis n’importe quel canevas, en une phrase, sans décider encore ce que c’est.
- **Voir toutes les idées d’un coup**, les plus récentes d’abord, filtrées par étape d’une simple pression.
- **Planifier l’entretien client qui teste une idée** en un clic, relié dans les deux sens.
- **Voir quelles idées sont réellement testées** — et combien d’idées ouvertes n’ont encore fait l’objet d’aucune conversation avec un client.
- **Demander à Brain d’étudier n’importe quelle idée** du tableau, car chaque idée est déjà une carte qu’il peut lire et compléter.

---

**À lire aussi :** [Lire, Prouver, Construire — la boucle intérieure](/blog/read-prove-build-the-inner-loop) · [Huit façons de rendre une idée réelle](/blog/eight-ways-to-make-an-idea-real) · [Des retours clients à dix maquettes](/blog/customer-feedback-to-ten-mockups)

[Ouvrez un canevas](/create), appuyez sur Idées, et notez celle que vous vouliez tester depuis longtemps.
