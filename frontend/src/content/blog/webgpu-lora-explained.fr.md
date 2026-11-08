# L’affinage LoRA WebGPU expliqué

La plupart des flux d’affinage d’IA se ressemblent : téléverser vos données chez un fournisseur cloud, démarrer une coûteuse instance A100, attendre la fin de l’entraînement, télécharger les poids. Builderforce jette ce schéma à la poubelle.

Voici comment nous exécutons l’entraînement LoRA directement dans l’onglet de votre navigateur grâce aux shaders de calcul WebGPU.

![Décomposition LoRA : les poids de base gelés W₀ plus le produit de deux petites matrices d’adaptateur entraînables B et A donnent les poids adaptés W — avec des cartes de statistiques : environ 10 000 fois moins de paramètres entraînables, jusqu’à 2 milliards de paramètres dans le navigateur et zéro facture de GPU cloud](/blog/webgpu-lora.svg)

## Contexte : qu’est-ce que LoRA ?

**LoRA** (Low-Rank Adaptation, adaptation de bas rang) est une technique d’affinage économe en paramètres introduite par Hu et al. en 2021. Au lieu de mettre à jour tous les poids d’un grand modèle de langage, LoRA gèle les poids d’origine et injecte de petites **matrices d’adaptateur** dans chaque couche d’attention.

Formellement, pour une matrice de poids `W₀ ∈ ℝᵐˣⁿ`, LoRA ajoute :

```
W = W₀ + BA
```

où `B ∈ ℝᵐˣʳ` et `A ∈ ℝʳˣⁿ` avec un rang `r ≪ min(m, n)`.

N’entraîner que `B` et `A` réduit les paramètres entraînables d’un facteur 10 000 sur un modèle de 7 milliards de paramètres avec un rang de 8, ce qui rend l’entraînement dans le navigateur envisageable.

## Pourquoi WebGPU ?

WebGPU est le successeur moderne de WebGL, conçu spécifiquement pour le calcul sur GPU. Contrairement à WebGL, façonné autour du pipeline de rastérisation, WebGPU expose des shaders de calcul bruts via WGSL — parfaits pour les multiplications de matrices qui dominent l’entraînement des réseaux de neurones.

Principaux avantages par rapport à un repli sur CPU :
- **Opérations matricielles parallèles** — des milliers de fils de shader s’exécutent simultanément
- **Mémoire partagée** — GEMM par tuiles avec mise en cache sur la puce
- **Aucune sortie de données** — les poids ne quittent jamais votre machine

## Le pipeline d’entraînement de Builderforce

```
Dataset (JSONL) → Tokeniser → Batching → Forward Pass → Loss → Backward Pass → Weight Update → Repeat
```

Chaque étape s’exécute comme un pipeline de calcul WebGPU :

1. **Tokenisation** — s’exécute sur le CPU via le tokeniseur WASM de Transformers.js
2. **Passe avant** — couches d’attention et de propagation avant envoyées aux shaders du GPU
3. **Calcul de la perte** — entropie croisée sur la distribution du vocabulaire
4. **Passe arrière** — gradients calculés par différentiation automatique en mode inverse dans WGSL
5. **Mise à jour AdamW** — poids d’adaptateur LoRA `A` et `B` mis à jour avec de l’inertie

## SharedArrayBuffer et COOP/COEP

WebGPU exige `SharedArrayBuffer` pour transférer des données de tenseurs entre le CPU et le GPU sans copie. Cette API est conditionnée par des en-têtes d’isolation inter-origines :

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

Builderforce définit ces en-têtes sur chaque page, ce qui active `SharedArrayBuffer` tout en autorisant les polices et images inter-origines.

## Garanties de confidentialité

Comme l’entraînement se déroule entièrement dans votre navigateur :

- Vos données d’entraînement **ne quittent jamais votre machine**
- Les poids de votre modèle **ne touchent jamais nos serveurs** (sauf si vous publiez explicitement)
- Nous ne pouvons ni voir, ni consigner, ni monétiser vos données d’affinage

Les poids de l’adaptateur LoRA sont sérialisés depuis les tampons du GPU et peuvent être téléchargés sous forme de fichier `.safetensors` ou envoyés vers Cloudflare R2 sous votre compte.

## Limites

L’entraînement dans le navigateur a des contraintes :

| Facteur | Limite du navigateur | Équivalent cloud |
|--------|--------------|-----------------|
| Taille du modèle | environ 2 milliards de paramètres | Illimitée |
| VRAM | Partagée avec le système (environ 8 Go) | 40 à 80 Go |
| Vitesse d’entraînement | environ 50 jetons/s | environ 5 000 jetons/s |
| Taille de lot | 1 à 4 | 32 à 256 |

Pour des modèles plus gros ou une itération plus rapide, vous pouvez exporter votre jeu de données et poursuivre l’entraînement sur n’importe quelle plateforme standard : Builderforce ne vous gêne pas.

## Conclusion

L’affinage LoRA WebGPU dans le navigateur n’est pas un gadget : c’est une façon pratique de personnaliser de petits modèles pour des tâches précises sans aucune infrastructure cloud ni souci de confidentialité des données. Essayez-le dans [votre prochain projet](/dashboard) !
