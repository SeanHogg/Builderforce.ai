Quelqu'un dans votre équipe a déjà écrit comment vous livrez un changement de schéma. C'est dans `.claude/skills/ship-a-schema-change/SKILL.md`, avec à côté un script qui lance les contrôles, et Claude Code le suit à chaque fois.

Jusqu'à aujourd'hui, ce savoir s'arrêtait à la frontière de l'outil pour lequel il avait été écrit. Pour l'amener dans BuilderForce, vous colliez les instructions dans une zone de texte, vous perdiez le script, et vous espériez que personne ne modifierait une copie sans l'autre. La procédure qui marchait devenait deux procédures qui divergeaient.

Les skills sont désormais un **standard**, et BuilderForce le parle. Une skill est un dossier : un `SKILL.md` qui dit ce qu'elle est et quand l'utiliser, plus les scripts et les références vers lesquels elle pointe. Claude Code, Codex et une liste croissante d'outils d'agents lisent exactement cette forme — le format ouvert [Agent Skills](https://agentskills.io) — et chaque agent BuilderForce aussi, sur chaque surface.

## Apportez le dossier, gardez le dossier

```bf-figure
{
  "kind": "flow",
  "title": "L'aller-retour d'une skill",
  "steps": [
    { "label": "Importer", "note": "Choisissez le dossier, un .zip de celui-ci ou un SKILL.md seul. Il est vérifié selon le standard avant tout envoi — nom, description, chaque chemin — et le verdict que vous voyez est celui auquel arrive le serveur.", "hue": "idea" },
    { "label": "Utiliser", "note": "Chaque agent de l'espace de travail en voit une ligne : son nom et quand l'utiliser. Quand une tâche correspond, l'agent charge les instructions ; quand les instructions demandent un script, il le charge aussi.", "hue": "make", "tag": "partout" },
    { "label": "La ressortir", "note": "Télécharger le dossier vous donne <name>.zip — le même SKILL.md et les mêmes fichiers, prêts pour .claude/skills ou .agents/skills. Ou publiez-la : ceux qui l'installent reçoivent exactement ce que vous exécutez.", "hue": "run" }
  ],
  "caption": "Rien n'est ressaisi et rien ne se perd à l'entrée ni à la sortie. Le dossier que vous importez est le dossier que vous exportez."
}
```

Importer, c'est valider. La personne qui apporte une skill est celle qui s'en porte garante : elle est donc en vigueur pour chaque agent dès sa prochaine exécution — le même état que produit l'approbation d'un relecteur, avec la même trace de qui l'a fait. Une skill proposée par un *agent* attend toujours comme brouillon qu'une personne l'approuve ; [cette boucle ne change pas](/blog/the-run-that-teaches-the-next-one), et les brouillons qu'elle produit sont désormais eux aussi des dossiers standard.

Vous pouvez aussi en écrire une dans le navigateur. **Nouvelle skill** demande un titre, le nom sous lequel les agents la chargent, quand l'utiliser et les étapes. Ce qui est enregistré est un `SKILL.md` standard : une skill née ici se télécharge et fonctionne n'importe où ailleurs.

## Une skill, partout où vos agents travaillent

La question qui comptait n'était pas « savons-nous lire un SKILL.md ? » mais « la skill atteint-elle l'agent qui en a besoin, où qu'il tourne ? ». Une skill qui marche dans les exécutions cloud et ne fait rien en silence dans l'éditeur est une skill à laquelle personne ne peut se fier.

```bf-figure
{
  "kind": "screen",
  "frame": "Là où les skills d'un espace de travail arrivent désormais",
  "ratio": 1.7,
  "regions": [
    { "label": "Exécutions cloud et conteneur", "note": "Le catalogue dans le prompt ; la skill chargée quand le ticket correspond", "x": 4, "y": 8, "w": 44, "h": 26, "hue": "make" },
    { "label": "Brain — web, VS Code, Rovr", "note": "Même catalogue, même chargeur, en pleine conversation", "x": 52, "y": 8, "w": 44, "h": 26, "hue": "idea" },
    { "label": "Canevas de création et Studio", "note": "L'assistant du tableau suit votre procédure pendant qu'il construit", "x": 4, "y": 40, "w": 44, "h": 26, "hue": "make" },
    { "label": "Agents auto-hébergés", "note": "Les skills assignées arrivent sur le disque comme de vrais dossiers ; .claude/skills et .agents/skills se chargent tels quels", "x": 52, "y": 40, "w": 44, "h": 26, "hue": "run" },
    { "label": "Tout client MCP", "note": "Claude, Cursor et les autres connectés à votre espace reçoivent le même outil", "x": 4, "y": 72, "w": 92, "h": 20, "hue": "accent" }
  ],
  "caption": "Un seul chargeur derrière tous. Ajoutez une skill une fois et chaque surface la voit à son prochain tour ; aucune n'en garde sa propre copie."
}
```

Sur un agent auto-hébergé, une skill assignée dans le portail arrivait autrefois sous forme de *nom* — « on vous a assigné ship-a-schema-change ; si un SKILL.md se trouve par hasard sur cette machine, suivez-le ». Désormais, le dossier lui-même est écrit sur le disque, scripts compris, et apparaît dans la liste de skills de l'agent comme une skill créée en local. Une skill que vous avez écrite vous-même sous le même nom l'emporte toujours ; la synchronisation n'écrase jamais un dossier qu'elle n'a pas écrit.

## Cinquante skills pour le prix de cinquante lignes

La meilleure idée du standard est qu'un agent ne devrait pas transporter chaque procédure dont il pourrait avoir besoin. Il voit un catalogue — une ligne par skill — et ne charge les instructions d'une skill que lorsque la tâche en cours y correspond. Une référence incluse n'est chargée que lorsque les instructions la désignent.

```bf-figure
{
  "kind": "compare",
  "title": "Ce qu'une exécution emporte avant de commencer",
  "columns": [
    { "title": "Toutes les skills collées", "hue": "muted", "items": ["Chaque procédure approuvée, en entier, dans chaque prompt", "Les longues, coupées au milieu d'une étape", "Les scripts nulle part — seulement la prose qui en parle", "Plus de skills, plus de coût, à chaque tour"] },
    { "title": "Le catalogue du standard", "hue": "make", "items": ["Une ligne par skill : son nom et quand l'utiliser", "Les instructions complètes quand — et seulement quand — la tâche correspond", "Scripts et références inclus, à la demande", "Une bibliothèque qui grandit sans faire grossir chaque prompt"] }
  ],
  "caption": "Les skills assignées directement à une exécution, un projet ou un agent sont toujours fournies en entier — c'est un contrat plus fort qu'une entrée de catalogue, et il le reste."
}
```

## Sa place dans la méthode

Les skills vivent dans l'acte **Build** de [Read · Prove · Build](/blog/read-prove-build-the-inner-loop) — celui qui dépense. Read et Prove sont volontairement peu coûteux, pour que décider de construire soit une vraie décision. Une fois que vous construisez, la chose la plus coûteuse qu'un agent puisse faire est de redécouvrir comment votre équipe fait une chose déjà faite cent fois : quel contrôle lancer, quelle piste de migration demande une colonne, comment part une release.

Une skill, c'est ce savoir, écrit une fois. En faire un dossier standard est ce qui lui permet de voyager avec le travail au lieu de vivre dans un seul outil — si bien que la procédure qu'un ingénieur a peaufinée dans son éditeur est celle que suit l'exécution cloud au ticket suivant, et celle que suit l'assistant du tableau pendant qu'il construit. Build reste l'acte coûteux ; il cesse d'être celui où l'on paie deux fois la même leçon.

## Ce que vous pouvez faire dès aujourd'hui

- **Importer** un dossier de skill depuis Claude Code, le `.agents/skills` d'un dépôt ou le .zip d'un collègue, scripts et références compris.
- **Écrire** une skill dans le navigateur et obtenir un `SKILL.md` standard.
- **Télécharger** n'importe quelle skill de l'espace de travail, ou n'importe quelle skill publiée sur la marketplace, comme un dossier prêt à l'emploi.
- **Publier** une skill sur la marketplace depuis son dossier, pour que l'annonce et ce que reçoivent les utilisateurs ne divergent jamais.
- **Utiliser** chaque skill depuis les exécutions cloud, le Brain sur le web, dans VS Code et dans Rovr, le canevas de création et le Studio — et depuis les agents auto-hébergés, où les skills assignées arrivent désormais sur le disque.

---

**À lire aussi :** [L'exécution qui instruit la suivante](/blog/the-run-that-teaches-the-next-one) · [Montrez-le une fois, il le refait](/blog/teach-it-once-and-it-does-it-again) · [Skills, assignations et marketplace](/blog/skills-assignment-and-the-marketplace)

[Ouvrez les skills de votre espace de travail](/skills) et importez le dossier en lequel votre équipe a déjà confiance.
