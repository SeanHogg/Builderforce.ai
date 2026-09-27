Chaque outil d’IA que vous utilisez commence la conversation à zéro.

Vous réexpliquez le projet. Vous rappelez la décision prise la semaine dernière, la convention retenue, la raison pour laquelle vous avez écarté la solution évidente. L’outil répond bien, puis oublie. Demain, vous réexpliquez tout — à un autre outil, dans une autre fenêtre, avec les mêmes mots.

Et quand la réponse est « il faut le faire », la discussion ne sert plus à rien. Le travail vit ailleurs : un tableau, un ticket, un agent embauché dans un autre onglet.

Voilà le manque : **ce à quoi vous parlez ne vous connaît pas, et ne peut pas confier le travail à ceux qui pourraient le faire.**

## Interrogez le cerveau qui vous connaît

Synapse se connecte désormais à Builderforce comme l’extension VS Code : vous approuvez un code dans votre navigateur, et la clé reste dans le magasin d’identifiants de votre système. Les discussions de votre espace de travail arrivent avec : les mêmes conversations que sur le web et dans votre éditeur.

```bf-figure
{
  "kind": "flow",
  "title": "D’une question à un travail fait",
  "steps": [
    { "label": "Demander", "note": "Écrivez au Brain depuis Synapse, dans n’importe quelle discussion de votre espace de travail.", "hue": "idea" },
    { "label": "Se souvenir", "note": "Avant de répondre, votre Evermind privé se rappelle ce que vos propres outils ont appris sur la question — sur votre machine.", "hue": "make", "tag": "privé" },
    { "label": "Assigner", "note": "Si c’est du travail, ajoutez un agent à la discussion et adressez-vous à lui avec @.", "hue": "run" },
    { "label": "Fait par l’agent", "note": "L’agent répond avec ses propres outils, en votre nom — jamais au-delà de ce que vous pourriez faire vous-même.", "hue": "run" }
  ],
  "caption": "Le Brain répond à ce qu’il peut avec ce que vous savez déjà ; les agents font ce qui demande des outils."
}
```

La réponse du Brain s’appuie sur votre propre mémoire. Les faits retenus par vos agents de code, les procédures apprises à Synapse, les conventions sur lesquelles vous les avez corrigés : tout cela est rappelé sur votre machine pour cette question, et seuls les quelques éléments utiles l’accompagnent.

## Confiez le travail à un agent

Chaque discussion a ses agents : ceux que votre espace de travail a embauchés, achetés ou enregistrés. Assignez-en un depuis la discussion, puis adressez-vous à lui — choisissez-le dans *À*, ou commencez le message par `@` et son nom.

```bf-figure
{
  "kind": "screen",
  "frame": "Synapse — Discussion",
  "ratio": 1.6,
  "regions": [
    { "label": "Vos discussions", "note": "Les mêmes conversations que sur le web et dans VS Code", "x": 3, "y": 8, "w": 24, "h": 86, "hue": "muted" },
    { "label": "Agents de cette discussion", "note": "À assigner depuis le vivier de votre espace de travail ; à retirer en un clic", "x": 30, "y": 8, "w": 67, "h": 12, "hue": "accent" },
    { "label": "La conversation", "note": "De qui vient chaque réponse — vous, le Brain ou l’agent — et à qui chaque message était destiné", "x": 30, "y": 24, "w": 67, "h": 52, "hue": "run" },
    { "label": "À : Brain ou @agent", "note": "Entrée envoie ; l’agent visé répond avec ses propres outils", "x": 30, "y": 80, "w": 67, "h": 14, "hue": "make" }
  ],
  "caption": "Un message au Brain reçoit sa réponse sur votre bureau avec votre mémoire privée ; un message à un agent reçoit la réponse de cet agent."
}
```

L’agent s’exécute sur la plateforme avec ses propres outils, en votre nom et dans les limites de vos droits — le même agent que vous joindriez depuis le web, désormais à un `@` de la conversation où vous êtes déjà.

## Regardez-le apprendre

Synapse dessine votre Evermind sous la forme d’un cerveau, et le garde dans la barre latérale, bien en vue.

```bf-figure
{
  "kind": "compare",
  "title": "Deux hémisphères, à partir de vos propres données",
  "columns": [
    { "title": "Gauche — ce qu’il sait", "hue": "make", "items": ["Néocortex : procédures que votre modèle privé a apprises dans ses poids", "Mémoire sémantique : faits retenus par chaque outil d’IA de cette machine", "Thalamus : ce que vos outils demandent à l’index de code, en ce moment"] },
    { "title": "Droite — ce qu’il fait", "hue": "run", "items": ["Hippocampe : démonstrations que vous avez enregistrées", "Ganglions de la base : compétences compilées, et le résultat de leurs exécutions", "Amygdale : étapes irréversibles pour lesquelles il s’est arrêté pour vous demander", "Hypothalamus : routines qui le lancent d’elles-mêmes"] }
  ],
  "caption": "Chaque nombre vient de votre magasin. Une région s’illumine pendant qu’elle apprend ; les nouvelles connaissances apparaissent en pulsant."
}
```

Ouvrez Evermind et le cerveau occupe la page : ce que le modèle a appris et ce qui attend, la perte d’entraînement de chaque adaptation, trente jours de démonstrations, de compétences, d’exécutions et d’apprentissage, et la liste de ce qu’il a assimilé en dernier — cliquez sur une région pour ne voir que ce qui y est arrivé.

## Sa place dans la méthode

Le travail sur Builderforce suit un arc — **Idée → Faire → Exploiter → Mesurer** — et chaque acte suit la même boucle interne : [Lire, Prouver, Construire](/blog/read-prove-build-the-inner-loop).

La discussion est l’endroit où commence l’**Idée**, et elle commençait à froid. Désormais, la première **Lecture** est votre propre mémoire : avant de répondre, le Brain lit ce que vous et vos outils avez déjà établi, et l’idée repart d’où vous l’aviez laissée plutôt que de zéro.

**Exploiter**, c’est là que sont les agents, et s’adresser à l’un d’eux depuis la discussion, c’est passer de la parole aux actes sans quitter la conversation.

**Mesurer**, c’est le cerveau. Ce que vous avez appris, ce qui s’est exécuté, ce que le modèle a retenu et l’évolution de sa perte sont dessinés à partir du magasin, pas décrits — une preuve visible que cette capacité privée grandit réellement.

## Ce que vous pouvez faire dès aujourd’hui

- **Vous connecter à Builderforce depuis Synapse** et travailler dans les mêmes discussions que sur le web et dans VS Code.
- **Interroger le Brain** et obtenir des réponses fondées sur ce que votre Evermind privé a appris sur votre machine.
- **Assigner des agents à une discussion et vous adresser à eux avec @** — ils font le travail avec leurs propres outils, en votre nom.
- **Regarder votre Evermind apprendre** dans la barre latérale, et voir l’ensemble — régions, perte d’entraînement, trente jours d’activité — sur la page Evermind.

[Téléchargez Synapse](https://github.com/SeanHogg/Builderforce.ai/releases?q=desktop-v&expanded=true), ouvrez **Discussion** et connectez-vous avec votre navigateur.

---

**À lire aussi :** [Montrez-le une fois, il le refera](/blog/teach-it-once-and-it-does-it-again) · [Un index local pour chaque outil d'IA de votre machine](/blog/one-local-index-for-every-ai-tool)
