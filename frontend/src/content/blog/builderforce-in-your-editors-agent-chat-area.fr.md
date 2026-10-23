# BuilderForce s'installe dans la zone de chat des agents de VS Code, à côté de votre code

VS Code a désormais un emplacement pour les agents de code. La barre latérale secondaire, à droite, regroupe Chat, Claude Code et Codex, chacun dans son propre onglet. Vous écrivez là, et le code que l'agent modifie reste ouvert dans l'éditeur, juste à côté.

BuilderForce n'était pas dans cette rangée. Son chat s'ouvrait dans un **onglet de l'éditeur** et prenait donc la place dont votre code avait besoin. Pour voir un agent modifier un fichier, il fallait diviser l'éditeur à la main ou passer sans cesse de la conversation au code.

BuilderForce a maintenant son propre onglet dans cette rangée.

```bf-figure
{
  "kind": "screen",
  "frame": "VS Code avec BuilderForce dans la zone de chat des agents",
  "ratio": 1.78,
  "regions": [
    { "label": "Barre latérale", "note": "Sessions, Travail, Boîte de réception, Santé", "x": 2, "y": 6, "w": 18, "h": 88, "hue": "muted" },
    { "label": "Votre code", "note": "Le fichier que l'agent modifie, en pleine largeur", "x": 22, "y": 6, "w": 46, "h": 88, "hue": "make" },
    { "label": "Chat · Claude Code · Codex · BuilderForce", "x": 70, "y": 6, "w": 28, "h": 8, "hue": "accent" },
    { "label": "BuilderForce", "note": "La même conversation, les mêmes exécutions et validations que partout ailleurs", "x": 70, "y": 16, "w": 28, "h": 78, "hue": "idea" }
  ],
  "caption": "L'éditeur garde le code, la zone de chat des agents garde la conversation. Plus besoin de choisir entre les deux."
}
```

## Un seul chat, à un seul endroit

Ce n'est pas un deuxième chat. L'onglet affiche la même conversation que sur le web : la même transcription, les mêmes validations d'outils, le même choix de modèle, le même périmètre de projet. Une exécution continue pendant que l'onglet est masqué, car l'agent tourne dans l'extension, pas dans l'onglet.

Tous les moyens d'ouvrir un chat mènent désormais à cet onglet : la commande **Ouvrir le chat**, une session choisie dans la liste des sessions, *Travailler sur cette tâche* depuis le tableau et un prompt envoyé depuis Project 360. « Ouvre mon chat » mène toujours au même endroit.

```bf-figure
{
  "kind": "flow",
  "title": "Toutes les entrées, une seule destination",
  "steps": [
    { "label": "Demander", "note": "Ouvrir le chat, une session de la barre latérale, une tâche, un prompt de Project 360", "hue": "idea" },
    { "label": "Arriver", "note": "L'onglet BuilderForce de la zone de chat des agents s'ouvre sur cette conversation", "hue": "make", "tag": "à côté de votre code" },
    { "label": "Suivre", "note": "Les modifications arrivent dans l'éditeur voisin ; les validations et l'indicateur Modifications restent visibles", "hue": "run" }
  ],
  "caption": "Les tableaux s'ouvrent toujours dans l'éditeur, car un canevas a besoin de largeur. Si vous préférez un onglet d'éditeur par conversation, le réglage des onglets par session vous le donne toujours."
}
```

Dans les versions de VS Code antérieures à 1.106, qui n'ont pas de zone de chat des agents, le même onglet apparaît dans la barre latérale BuilderForce.

## Sa place dans la méthode

Construire est le troisième acte, après [Lire et Prouver](/blog/read-prove-build-the-inner-loop), et c'est là que la boucle courte entre *demander un changement* et *voir le changement* compte le plus. Chaque sortie de cette boucle coûte de l'attention : un changement d'onglet, une division mise en place à la main, une conversation qui masque le fichier qu'elle modifie.

```bf-figure
{
  "kind": "compare",
  "title": "Suivre un agent qui modifie votre code",
  "columns": [
    { "title": "Le chat dans un onglet de l'éditeur", "hue": "muted", "items": ["Le chat prend la place de l'éditeur", "Diviser l'éditeur à la main ou passer de l'un à l'autre", "Le fichier modifié est à un clic", "Chaque point d'entrée pouvait ouvrir son propre onglet"] },
    { "title": "Le chat dans la zone de chat des agents", "hue": "make", "items": ["Le code en pleine largeur dans l'éditeur", "La conversation toujours à côté", "Validations et modifications visibles pendant la lecture du diff", "Tous les points d'entrée mènent au même onglet"] }
  ],
  "caption": "Le même chat, les mêmes exécutions. Seul son emplacement change."
}
```

Fabriquer, Exécuter et Mesurer se passent sur la plateforme. Quand le travail porte sur du code sur votre propre machine, Fabriquer se passe dans votre éditeur, et l'agent qui s'en charge se trouve désormais dans la zone de chat des agents de l'éditeur, à côté de votre code.

## Essayez

Mettez à jour l'extension BuilderForce, rechargez VS Code et ouvrez la zone de chat des agents. BuilderForce y a son propre onglet, à côté de Chat, Claude Code et Codex. Ou lancez **BuilderForce : Ouvrir le chat**, et il s'ouvrira là.

---

**À lire aussi :** [Lire, Prouver, Construire : la boucle interne](/blog/read-prove-build-the-inner-loop) · [Sans compte, sans GPU, sans réseau](/blog/no-account-no-gpu-you-choose-where-it-runs)
