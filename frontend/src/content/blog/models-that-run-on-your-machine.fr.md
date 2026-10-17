Chaque token que vous envoyez à un modèle dans le cloud quitte votre machine, et chacun est facturé. Pour l’essentiel du travail, c’est un échange équitable. Pour une note privée, une reformulation rapide, une question sur du code que vous préféreriez ne coller nulle part, ou un après-midi dans un train sans réseau, ce ne l’est pas.

Faire tourner un petit modèle en local a toujours été la réponse évidente, et cela a toujours cassé au même endroit. Un petit modèle a une petite fenêtre de contexte. Commencez une tâche sur un modèle de pointe, passez à un modèle local en cours de route, et le modèle local reçoit une transcription plusieurs fois plus grande que ce qu’il peut contenir. Il la tronque, oublie la consigne ou échoue purement et simplement. Dans l’autre sens, le modèle cloud reprend sans savoir ce que le modèle local vient de faire.

Cette version referme les deux moitiés. Vous pouvez désormais faire tourner un modèle sur votre propre machine, depuis le sélecteur que vous utilisez déjà, et quand une exécution passe d’un modèle à un autre, le suivant reçoit une conversation compactée pour sa propre fenêtre.

## Choisir un modèle qui tourne sur cet appareil

Ouvrez le menu `/` dans le champ de saisie, allez dans **Modèle** et choisissez **Sur cet appareil**. La liste affiche tous les modèles capables de tourner sur le GPU de votre navigateur grâce à WebGPU. Appuyez une fois sur **Télécharger** ; votre navigateur enregistre le modèle et, à partir de là, il se charge depuis le disque.

```bf-figure
{
  "kind": "screen",
  "frame": "Menu / · Modèle · Sur cet appareil",
  "ratio": 1.6,
  "regions": [
    { "label": "Sur cet appareil", "note": "Le même sélecteur que pour les modèles cloud, filtré sur ce qui tourne sur votre GPU", "x": 3, "y": 5, "w": 94, "h": 13, "hue": "idea" },
    { "label": "Bonsai 8B", "note": "1 bit · 1,16 Go · appels d’outils · moteur Builderforce", "x": 3, "y": 22, "w": 62, "h": 15, "hue": "run" },
    { "label": "Prêt", "note": "Téléchargé une fois, chargé depuis le disque, fonctionne hors ligne", "x": 68, "y": 22, "w": 29, "h": 15, "hue": "good" },
    { "label": "Bonsai 4B", "note": "1 bit · 0,57 Go · appels d’outils", "x": 3, "y": 41, "w": 62, "h": 15, "hue": "run" },
    { "label": "62 %", "note": "Téléchargement en cours, avec une progression visible", "x": 68, "y": 41, "w": 29, "h": 15, "hue": "prove" },
    { "label": "Bonsai 1.7B", "note": "1 bit · 0,25 Go · appels d’outils", "x": 3, "y": 60, "w": 62, "h": 15, "hue": "run" },
    { "label": "Télécharger", "note": "Un clic ; jamais lancé par un tour de conversation", "x": 68, "y": 60, "w": 29, "h": 15, "hue": "make" },
    { "label": "Hermes 3 8B", "note": "Ne tient pas sur ce GPU, et la ligne dit pourquoi", "x": 3, "y": 79, "w": 94, "h": 15, "style": "ghost" }
  ],
  "caption": "Téléchargement, progression, prêt. Un modèle qui ne peut pas tourner sur votre appareil reste dans la liste et indique ce qu’il lui faudrait."
}
```

Deux moteurs se trouvent derrière cette liste.

- **Bonsai 1 bit 8B, 4B et 1.7B** de PrismML, sous Apache-2.0, d’environ 1,16 Go, 0,57 Go et 0,25 Go. Ils tournent sur le moteur propre à Builderforce, celui-là même sur lequel [Synapse tourne sur le bureau](/blog/synapse-runs-models-itself), compilé pour le navigateur. Tous les trois appellent des outils : ils peuvent donc faire du travail d’agent, pas seulement discuter.
- **Les modèles WebLLM** : Qwen3 1.7B et 4B, Llama 3.2 3B, et Hermes 3 8B, qui appelle lui aussi des outils.

Le sélecteur est le même partout où vous travaillez avec Builderforce : l’extension VS Code, [Rovr](/blog/rovr-your-assistant-in-the-browser) dans Chrome et builderforce.ai. Avant de proposer un modèle, il vérifie votre appareil. Un modèle trop grand pour la mémoire de votre GPU, ou qui exige une fonction GPU que le vôtre n’a pas, n’est pas masqué : il dit pourquoi il ne tournera pas.

Quand vous en choisissez un, vos prompts pour ces tours ne quittent jamais votre machine. Aucune requête n’arrive sur un serveur pour être journalisée, aucun token n’est facturé et, une fois le modèle téléchargé, aucun réseau n’est nécessaire.

## Passer d’un modèle à l’autre sans perdre le fil

Le vrai travail reste rarement sur un seul modèle. Vous rédigez en privé avec un modèle local et confiez la partie difficile à un modèle cloud. Un plan est écrit par un modèle et codé par un autre. Un fournisseur tombe en panne en pleine exécution et Builderforce bascule sur le suivant. À chacun de ces passages, le modèle suivant recevait jusqu’ici toute la conversation, en espérant qu’elle tienne.

Désormais, chaque passage transite par **builderforce-memory**, qui compacte la conversation pour le modèle sur le point de prendre le relais.

```bf-figure
{
  "kind": "flow",
  "title": "Un passage de relais de votre appareil vers le cloud",
  "steps": [
    { "label": "Modèle local", "note": "Bonsai rédige en privé dans votre navigateur, avec une fenêtre d’environ 14 000 tokens.", "hue": "run", "tag": "sur l’appareil" },
    { "label": "Memory compacte", "note": "builderforce-memory garde le prompt système, votre dernière consigne mot pour mot et le travail récent, et transforme le reste en un résumé ou un rappel.", "hue": "prove", "tag": "tient dans la fenêtre suivante" },
    { "label": "Note de relais", "note": "Le contexte compacté commence par une ligne indiquant quel modèle a passé le relais à quel autre.", "hue": "idea" },
    { "label": "Modèle cloud", "note": "Reprend la tâche en sachant ce qui s’est passé, pas seulement où la transcription s’arrêtait.", "hue": "make", "tag": "dans le cloud" }
  ],
  "caption": "Le même compactage fonctionne dans l’autre sens : un petit modèle local ne reçoit jamais une transcription qu’il ne peut pas contenir."
}
```

Les règles sont simples. Le prompt système reste. Votre dernière consigne reste mot pour mot. Un appel d’outil n’est jamais séparé de son résultat. Les tours les plus récents restent intacts tant que la fenêtre du modèle suivant le permet, et le milieu plus ancien devient une seule note : un résumé quand il peut être produit, sinon ce que la mémoire rappelle à propos de votre consigne. La conversation compactée tient toujours dans la fenêtre du modèle qui la reçoit, avec de la place pour sa réponse.

Résultat : un petit modèle reçoit une conversation avec laquelle il peut vraiment travailler, et un grand modèle qui prend la suite d’un petit sait ce qui a été fait.

```bf-figure
{
  "kind": "compare",
  "title": "Sur cet appareil ou dans le cloud",
  "columns": [
    { "title": "Sur cet appareil", "hue": "run", "items": ["Les prompts ne quittent jamais votre machine", "Aucun coût par token", "Fonctionne hors ligne une fois téléchargé", "Modèles Bonsai et WebLLM, jusqu’à environ 8B", "Nécessite un navigateur et un GPU compatibles WebGPU", "Fenêtre plus petite et moins de profondeur que les modèles de pointe"] },
    { "title": "Cloud Builderforce", "hue": "make", "items": ["Modèles de pointe et longues fenêtres", "Rien à télécharger", "Fonctionne sur tout navigateur et tout appareil", "Facturé au token", "Reprend une exécution avec une note de relais", "Le bon choix pour les tâches longues et difficiles"] }
  ],
  "caption": "Choisissez à chaque tour. builderforce-memory fait en sorte que passer de l’un à l’autre ne vous coûte aucun contexte."
}
```

## À quoi s’attendre

Quelques limites honnêtes, parce qu’un modèle local qui déçoit est pire qu’un modèle jamais essayé.

- **Il faut WebGPU.** Les versions actuelles de Chrome et d’Edge le proposent sur la plupart des ordinateurs de bureau. Un navigateur ou un GPU sans WebGPU ne peut pas faire tourner ces modèles, et le sélecteur le dit au lieu d’échouer plus tard.
- **Le premier téléchargement est lourd.** Bonsai 8B pèse environ 1,16 Go. Il se télécharge une fois, puis se charge depuis le disque ; vous pouvez le retirer depuis le même sélecteur.
- **Ce sont de petits modèles.** Ils sont bons pour rédiger, reformuler, répondre à des questions courtes et faire des appels d’outils ciblés. Ce ne sont pas des modèles de pointe, et sur une tâche longue et embrouillée, un modèle cloud fera mieux.
- **La fenêtre est plus petite que dans le cloud.** Dans le navigateur, Bonsai 8B tient environ 14 000 tokens de contexte sur un GPU qui gère la demi-précision, et environ 7 000 sans. C’est exactement pour cela que le compactage du relais existe, et pourquoi il compte surtout dans ce sens.

## Sa place dans la méthode

Le travail sur Builderforce suit un arc, **Idée → Créer → Piloter → Mesurer → Portée**, et à l’intérieur la boucle qui décide de ce qui vaut la peine d’être construit : [Lire, Prouver, Construire](/blog/read-prove-build-the-inner-loop).

- **Lire** devient moins cher et plus privé. Réfléchir à une idée, relire vos propres notes et poser les questions que vous ne colleriez jamais dans un outil cloud : tout cela peut se faire sur votre appareil, sans coût.
- **Prouver** garde bon marché ce qui doit l’être. Lire et Prouver sont les actes qui ne devraient rien dépenser ; un modèle local fait tourner les petites vérifications sans dépenser un token, et le budget reste pour la preuve qui exige un modèle de pointe.
- **Construire** est là où les relais paient. Un plan rédigé en local arrive compacté au modèle qui code, avec la consigne intacte et une note de ce qui a été décidé.
- **Piloter** devient plus stable. Quand un fournisseur tombe en panne en pleine exécution, le modèle qui prend le relais reçoit une conversation à sa taille : la bascule poursuit le travail au lieu de le recommencer.
- **Mesurer** gagne l’économie la plus simple qui soit : un tour traité sur votre appareil est un tour que personne ne facture.

## Ce que vous pouvez faire dès aujourd’hui

- **Rédiger en privé.** Choisissez Bonsai ou un modèle WebLLM sous **Sur cet appareil**, et rien de ce que vous tapez dans ces tours ne quitte votre machine.
- **Travailler hors ligne.** Téléchargez un modèle avant de partir ; il tourne sans aucune connexion.
- **Commencer petit, finir grand.** Démarrez sur un modèle local et passez à un modèle cloud quand la tâche grandit. Le modèle cloud reçoit une conversation compactée et une note de relais.
- **Utiliser le même modèle partout.** Le sélecteur est le même dans VS Code, dans Rovr et sur builderforce.ai.
- **Savoir pourquoi un modèle ne tourne pas.** Un modèle qui ne tient pas sur votre appareil indique ce qui manque, au lieu d’échouer en plein téléchargement.

Ouvrez le menu `/`, choisissez **Modèle** puis **Sur cet appareil**, et téléchargez-en un.

---

**À lire aussi :** [Synapse fait désormais tourner les modèles lui-même](/blog/synapse-runs-models-itself) · [L’IA en local avec WebGPU dans le navigateur](/blog/local-first-ai-webgpu-in-the-browser) · [Voici Rovr](/blog/rovr-your-assistant-in-the-browser) · [Lire, Prouver, Construire](/blog/read-prove-build-the-inner-loop)
