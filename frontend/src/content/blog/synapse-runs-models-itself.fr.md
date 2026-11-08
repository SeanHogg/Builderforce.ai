# Synapse exécute désormais les modèles lui-même

Synapse exécute désormais les modèles lui-même. Ollama n’est pas nécessaire.

Jusqu’à cette bascule, les modèles locaux dans Synapse signifiaient installer l’environnement d’exécution de quelqu’un d’autre, espérer qu’il soit dans le PATH et s’accommoder des types de GGUF que cet environnement acceptait. C’était un produit que nous ne maîtrisions pas, sur le chemin critique d’un produit que nous maîtrisons.

```bf-figure
{
  "kind": "flow",
  "title": "De l’installation à un modèle dans l’éditeur",
  "steps": [
    { "label": "Synapse", "note": "L’application de bureau démarre et supervise bfi serve. Aucune installation d’Ollama.", "hue": "idea" },
    { "label": "bfi", "note": "Le moteur natif charge le GGUF — y compris PrismML PQ2_0 et PTQ1_0.", "hue": "make" },
    { "label": "desktop.json", "note": "Synapse écrit ~/.builderforce/desktop.json avec le point d’accès des modèles.", "hue": "run" },
    { "label": "VS Code", "note": "L’extension BuilderForce découvre l’identifiant de fournisseur synapse et liste ces modèles.", "hue": "run" }
  ],
  "caption": "Un seul environnement d’exécution sur la machine. L’éditeur le trouve. Ollama n’est pas sur le chemin."
}
```

## Pourquoi nous avons remplacé Ollama

Trois coûts, tous payés par la personne qui essaie d’exécuter un modèle sur sa propre machine.

**Une étape d’installation hors de notre contrôle.** Si Ollama était absent, la vue Modèles renvoyait vers la page de téléchargement de quelqu’un d’autre. Synapse ne pouvait pas démarrer l’inférence locale tant que cet autre produit n’était pas présent et en bon état.

**Les formats que nous voulons le plus ne fonctionnaient pas dessus.** Ternary Bonsai 2 27B de PrismML est livré en GGUF `PQ2_0` / `PTQ1_0` — des blocs ternaires de 2 bits et d’environ 1,75 bit. Le llama.cpp standard, qu’Ollama embarque, rejette ces deux types. Seul un fork les exécutait. Un produit de modèles locaux qui ne peut pas charger les poids qui nous intéressent n’est pas un produit de modèles locaux.

**Le dimensionnement était une supposition.** Les estimations de mémoire provenaient d’une table fixe de bits par poids. Elle ne savait rien des formats ternaires, du coût du cache KV de l’attention hybride ni de la vraie charge de l’environnement d’exécution. `bfi fit` estime à partir du GGUF que nous chargeons réellement.

## L’histoire du 2 bits

`bfi` est un moteur entièrement en Rust dans [builderforce-inference](https://github.com/SeanHogg/builderforce-inference). Il lit le GGUF v2/v3, y compris `PQ2_0` (type 142) et `PTQ1_0` (type 143) de PrismML. Ce sont les dispositions 2 bits / ternaires que Bonsai 2 27B livre réellement — pas Q2_0 ni TQ1_0, qui ne peuvent pas représenter sans perte un point de contrôle à groupe de 128.

Synapse supervise `bfi serve` comme processus enfant : contrôles de santé, temporisation, redémarrage. Si le moteur meurt, Synapse continue de fonctionner. Le sidecar CPU est livré avec l’application. Vous pouvez aussi installer vous-même l’interface en ligne de commande :

```sh
cargo install --git https://github.com/SeanHogg/builderforce-inference bfi
```

Les binaires signés des versions GitHub ne sont pas encore publiés. Cela attend les secrets de signature du propriétaire, pas cette bascule.

## VS Code le trouve sur la machine

L’extension BuilderForce de VS Code ne devine pas un port. Elle lit `~/.builderforce/desktop.json` (Windows : `%USERPROFILE%\.builderforce\desktop.json` ; remplaçable par `BUILDERFORCE_DESKTOP_DISCOVERY`) :

```json
{
  "models": {
    "endpoint": "http://127.0.0.1:…",
    "provider": "synapse"
  }
}
```

L’identifiant du fournisseur local est `synapse`, jamais `bfi`. Le catalogue et l’installation passent par Synapse (`GET /v1/synapse/catalog`, `POST /api/pull`). Si Synapse n’est pas en cours d’exécution, le groupe ne s’affiche pas. Un fournisseur Ollama existant fonctionne toujours avec n’importe quel serveur compatible Ollama, y compris un `bfi serve` autonome.

## Ce que nous n’affirmons pas

Le sidecar CPU est livré. C’est cela, la bascule.

Nous n’avons **pas** affirmé que le GPU atteint 70 % du débit en jetons par seconde de llama-bench sur Metal ou NVIDIA. Les noyaux CubeCL compilent ; la mesure de décision n’a pas été effectuée.

Nous n’avons **pas** affirmé l’identité gloutonne en direct de Bonsai 27B par rapport au fork llama.cpp de PrismML. Les tests d’ajustement à 32K / 36 Gio réussissent sur CPU ; la comparaison en direct exige des poids que nous n’exécutons pas dans la CI.

Cela reste dans la ROADMAP. Cet article est la bascule, pas la ligne d’arrivée.
