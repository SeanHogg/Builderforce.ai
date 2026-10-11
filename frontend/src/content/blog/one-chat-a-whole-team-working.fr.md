Donnez à un agent une spécification avec huit chantiers et regardez ce qui se passe : il les fait un par un. La migration, puis les routes de l'API, puis le planificateur, puis l'interface, puis les tests. Chaque étape attend la précédente, même quand elles n'ont rien à voir. Un après-midi de travail prend tout l'après-midi.

Les gens ne travaillent pas comme ça. Un responsable découpe le travail, confie chaque morceau à quelqu'un qui en a la charge, garde un œil sur tout le monde et rassemble le tout à la fin. Jusqu'ici, un agent ne pouvait que *faire semblant*. Il pouvait lancer un assistant, mais il attendait ensuite que celui-ci finisse. L'assistant avait une limite d'étapes. Vous ne pouviez ni le voir ni lui parler. Et sur certains environnements cloud, il n'existait pas du tout.

Voilà le manque : **un chat ne pouvait faire qu'une chose à la fois, et le travail qui aurait pu avancer en parallèle faisait la queue.**

## Déléguer et continuer

Désormais, l'agent de votre chat peut confier des morceaux du travail à des **sous-agents**, qui démarrent immédiatement et travaillent côte à côte. L'agent qui les a lancés ne s'arrête pas. Il continue à planifier, à coder la partie qu'il a gardée, ou lance d'autres sous-agents.

```bf-figure
{
  "kind": "flow",
  "title": "D'une demande à un travail en parallèle",
  "steps": [
    { "label": "Découper", "note": "L'agent lit la spécification et la découpe en morceaux. Chaque morceau a ses propres fichiers, donc deux sous-agents ne modifient jamais la même chose.", "hue": "idea" },
    { "label": "Déléguer", "note": "Chaque morceau démarre comme un sous-agent avec son propre nom, ou comme un coéquipier de votre espace de travail. Tous démarrent en même temps.", "hue": "make", "tag": "en parallèle" },
    { "label": "Travailler", "note": "Les sous-agents travaillent côte à côte, sans limite d'étapes. Leurs messages apparaissent dans le chat sous leur propre nom.", "hue": "make" },
    { "label": "Rassembler", "note": "Chaque sous-agent fait son rapport une fois terminé. Le responsable compile et teste le changement d'ensemble, corrige ce que les morceaux ont cassé entre eux, puis fait le commit.", "hue": "run" }
  ],
  "caption": "Un sous-agent est une exécution d'agent comme une autre, à une différence près : il sait pour qui il travaille et lui rend compte."
}
```

Un sous-agent peut être anonyme (« porte le middleware d'authentification ») ou l'un des agents de votre espace de travail (« Ada, prends le schéma »). Si personne ne convient pour un morceau de code, le chat recrute un Developer pour lui, lui assigne le ticket et exécute le morceau en tant que ce Developer. Le tableau montre qui s'occupe de quoi.

## Vous voyez tout le monde, et pouvez parler à chacun

Une équipe qu'on ne voit pas, on ne peut pas la diriger. Chaque sous-agent actif apparaît dans la liste **Agents** du chat à côté des agents invités, avec son identifiant et celui qui l'a lancé. Un bandeau en direct sous la conversation montre ce que chacun fait en ce moment.

```bf-figure
{
  "kind": "screen",
  "frame": "BuilderForce — chat",
  "ratio": 1.5,
  "regions": [
    { "label": "Agents (4)", "note": "Agents invités et sous-agents actifs ensemble : « Vérifier le frontend · a3 — sous-agent de BuilderForce »", "x": 4, "y": 6, "w": 92, "h": 16, "hue": "accent" },
    { "label": "Leurs messages, sous leur nom", "note": "« QA TESTER — sous-agent de Vérifier le frontend · a4 »", "x": 4, "y": 26, "w": 92, "h": 36, "hue": "make" },
    { "label": "Sous-agents", "note": "Ce que chacun fait maintenant · Rediriger · Arrêter · Tout arrêter", "x": 4, "y": 66, "w": 92, "h": 28, "hue": "run" }
  ],
  "caption": "Un sous-agent peut lancer ses propres sous-agents pour une partie de sa tâche, jusqu'à trois niveaux. Le chat montre qui travaille pour qui."
}
```

Pour en rediriger un, parlez-lui simplement. `@Ada fais seulement la moitié API` atteint la prochaine étape de ce sous-agent. Mentionner un ticket sur lequel il travaille (`#2826 les cartes de brouillon ont besoin d'un état vide`) l'atteint aussi. **Arrêter** en arrête un, **Tout arrêter** arrête tous les sous-agents d'un coup.

Et l'agent à qui vous parlez reste le vôtre. S'il attend ses sous-agents et que vous lui envoyez un message, il cesse d'attendre et vous répond. Les sous-agents continuent de travailler, et leurs rapports lui parviennent toujours.

## La même équipe dans l'éditeur et dans le cloud

La plupart des outils qui font cela le font à un seul endroit. Ici, c'est une seule façon de travailler, où que le travail s'exécute.

```bf-figure
{
  "kind": "compare",
  "title": "Où un sous-agent peut s'exécuter",
  "columns": [
    { "title": "Avant", "hue": "muted", "items": ["Le responsable s'arrêtait jusqu'à ce que l'assistant ait fini", "Les assistants butaient sur une limite de 8 étapes", "Les assistants n'avaient pas de nom dans le chat", "Certains environnements cloud ne pouvaient pas en lancer"] },
    { "title": "Maintenant", "hue": "make", "items": ["Le responsable continue pendant que les sous-agents travaillent", "Pas de limite d'étapes : un sous-agent s'arrête quand son morceau est fini", "Chaque sous-agent a un nom, figure dans la liste et peut être joint", "Le même comportement dans VS Code et sur chaque environnement cloud"] }
  ],
  "caption": "Dans le cloud, chaque sous-agent est sa propre exécution avec son propre enregistrement, et ses tokens comptent pour l'exécution qui l'a lancé."
}
```

Quand quelque chose tourne mal, vous voyez où. **Copier le diagnostic** inclut désormais chaque sous-agent lancé par le chat, y compris ceux qui ont terminé. Pour chacun, il indique qui l'a lancé, les modèles utilisés, les étapes en échec, les fichiers modifiés et son rapport.

## Sa place dans la méthode

Le travail dans Builderforce suit un arc — **Idée → Faire → Exploiter → Mesurer** — et chaque acte suit la même boucle interne : [Lire, Prouver, Construire](/blog/read-prove-build-the-inner-loop).

Les sous-agents sont une fonctionnalité de **Faire**, et ils changent surtout l'étape **Construire**. Construire, c'est là que se fait le travail coûteux, et c'est là qu'une seule file de travail fait le plus de mal : chaque morceau attend le précédent. Une fois découpé, Construire coûte le morceau le plus long, pas la somme de tous.

Ils gardent aussi l'étape **Prouver** honnête. Les sous-agents n'ont ni shell ni git. Ils modifient leurs propres fichiers et font leur rapport. La preuve reste au responsable : compiler le changement d'ensemble, lancer les tests, corriger ce que les morceaux ont cassé entre eux, et seulement ensuite faire le commit. Un travail en parallèle, un seul verdict.

## Ce que vous pouvez faire dès aujourd'hui

- **Confier une spécification en plusieurs parties à un seul chat** et faire avancer ses chantiers en parallèle.
- **Déléguer à vos propres agents par leur nom**, ou laisser le chat recruter un Developer pour un morceau qui ne convient à personne.
- **Voir et piloter chaque sous-agent** : le rediriger avec `@nom` ou un `#ticket`, en arrêter un ou tous les arrêter.
- **Travailler de la même façon dans le cloud**, où chaque sous-agent est sa propre exécution avec son propre enregistrement.

Mettez à jour l'extension BuilderForce dans VS Code vers la version 2026.10.22 ou ultérieure pour profiter de tout cela.

---

**À lire aussi :** [Lire, Prouver, Construire — la boucle interne](/blog/read-prove-build-the-inner-loop) · [Montrez-le une fois, il le refera](/blog/teach-it-once-and-it-does-it-again)
