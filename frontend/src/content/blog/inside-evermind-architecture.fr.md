Nous avons publié la version courte de [la raison d'être d'Evermind](/blog/evermind-self-updating-model) : les modèles figés deviennent obsolètes dès leur mise en production, et greffer un magasin RAG à côté ne fait que déplacer l'obsolescence ailleurs. Voici la version longue — l'architecture réelle, les équations qui la sous-tendent, et un compte rendu délibérément honnête de ce que nous avons *prouvé*, de ce que nous avons *construit*, et de ce qui reste une *hypothèse*.

Elle accompagne un rapport technique complet rédigé en vue d'une relecture par les pairs. Si vous voulez le traitement de niveau thèse, avec chaque équation rattachée à son fichier source, c'est ce document qu'il vous faut. Cet article en est la visite guidée.

## La thèse, formulée précisément

Evermind fait de la **fraîcheur** des connaissances — et non de l'échelle — son axe de conception principal. Le pari n'est pas qu'« un petit modèle peut surpasser un grand en nombre de paramètres » — c'est impossible, et nous ne le prétendons pas. Le pari, c'est qu'une architecture dont *les connaissances sont toujours à jour par construction*, qui *maîtrise sa propre génération* et qui *tient dans le runtime où le travail s'effectue* l'emporte sur les axes auxquels un modèle de pointe figé renonce structurellement.

Evermind est le modèle lui-même — pas une mémoire greffée sur le LLM de quelqu'un d'autre. Il se compose de trois couches coopérantes qui reflètent une décomposition neurofonctionnelle grossière.

![L'architecture en trois couches d'Evermind : un cortex à espace d'états sélectif, un hippocampe en écriture directe et une couche limbique entraînable, précédés d'un routeur d'inférence doté d'une passerelle optionnelle vers un modèle de pointe](/blog/evermind-architecture-full.svg)

- **Cortex** — un modèle hybride à espace d'états à experts partagés, qui génère du langage en temps linéaire *et* peut effectuer un pas de gradient sur l'appareil même qui le sert.
- **Hippocampe** — une mémoire de connaissances en écriture directe qui *remplace* les croyances à l'écriture au lieu de les ajouter.
- **Limbique** — une petite cellule récurrente entraînable qui module l'affect.

Toutes trois sont différentiables. Toutes trois tournent sur WebGPU sans aucune dépendance d'exécution. Passons-les en revue.

## Le cortex : un générateur à espace d'états sélectif

Le générateur n'est pas une pile d'attention — c'est un modèle à espace d'états (SSM) sélectif de la famille Mamba. Chaque canal conserve un état caché `h_t` qui évolue selon une récurrence linéaire dépendante de l'entrée. Après une discrétisation par bloqueur d'ordre zéro, avec un pas `Δ_t` sélectif selon le contenu, la mise à jour par token s'écrit simplement :

```
Ā_t = exp(Δ_t · A)              # state decay (A stored as log(−A) for stability)
B̄_t = (Ā_t − 1) / A · B_t       # input gain
h_t = Ā_t ⊙ h_{t−1} + B̄_t · x_t  # recurrence
y_t = C_t · h_t + D · x_t        # readout
```

Le mot qui compte, c'est **sélectif** : `Δ_t`, `B_t` et `C_t` sont projetés à partir du token lui-même, si bien que la dynamique dépend du contenu. C'est ce qui confère à un SSM une expressivité comparable à celle de l'attention, pour un coût linéaire.

À l'intérieur d'un bloc, l'entrée est normalisée par RMS, projetée, passée dans une convolution causale 1-D et une porte SiLU, traitée par le scan sélectif, à nouveau filtrée par `SiLU(z)`, projetée vers le bas, puis ajoutée à un flux résiduel. Trois variantes partagent ce squelette : **Mamba-1** (le scan S6 ci-dessus), **Mamba-2** (dualité espace d'états structurée — un seul scalaire `A` par tête, qui expose une forme en multiplication matricielle) et **Mamba-3** (un état à valeurs complexes avec une discrétisation exponentielle-trapézoïdale, offrant des modes oscillatoires qu'un `A` diagonal réel ne peut pas représenter). Des couches d'attention optionnelles peuvent être intercalées selon un schéma hybride.

![Le bloc SSM sélectif : RMSNorm, projection d'entrée, convolution causale, le scan sélectif piloté par des (Δ, B, C) dépendants de l'entrée, une porte SiLU et une addition résiduelle](/blog/evermind-ssm-block.svg)

### Pourquoi il se parallélise

Une récurrence linéaire a l'air séquentielle, mais elle ne l'est pas. Écrivez chaque étape sous la forme d'une paire `(a, b) = (Ā_t, B̄_t·x_t)` et définissez l'opérateur

```
(a₁, b₁) ∘ (a₂, b₂) = (a₁·a₂,  a₁·b₂ + b₁)
```

Cet opérateur est **associatif** (le rapport technique le démontre, avec l'élément neutre `(1, 0)`), et la seconde composante courante du produit préfixe est exactement `h_t`. Tout repose sur l'associativité : n'importe quel scan associatif calcule tous les préfixes en `⌈log₂ L⌉` passes parallèles. Les états d'une séquence de longueur `L` s'obtiennent donc avec une profondeur `O(log L)` et un travail `O(L)` — contre un travail `O(L²)` pour l'attention dense.

![La récurrence sélective évaluée comme un scan préfixe associatif parallèle — log L passes sur des paires (a, b)](/blog/evermind-parallel-scan.svg)

### Il s'entraîne sur l'appareil qui le sert

Le moteur embarque une différentiation automatique en mode inverse fondée sur une bande d'enregistrement (tape) et un optimiseur AdamW sur GPU, ce qui permet au cortex d'effectuer des pas de gradient dans le navigateur. Nous utilisons aussi **WSLA** (Weight-Selective Layer Adaptation) : les mises à jour en ligne ne touchent que les lignes de projection sélective qui décident de la manière dont le contenu est acheminé vers l'état, en gelant l'essentiel de la représentation. C'est ce qui rend l'apprentissage en ligne suffisamment peu coûteux pour tourner en quelques époques, sans cluster d'entraînement dédié.

## L'hippocampe : Write-Through Cognition

Voici la partie véritablement différente. La mise en cache garde les *réponses* à jour ; l'hippocampe garde les *connaissances* à jour.

Chaque fait candidat passe par un seul et même pipeline : **canonicaliser** vers une clé de sujet stable → **rappeler** la croyance en place → **évaluer** les preuves → **réconcilier** → **écrire directement**. La réconciliation renvoie l'un de quatre verdicts :

- **augment** — sujet entièrement nouveau ; on l'écrit.
- **confirm** — identique à la croyance en place ; on rafraîchit simplement la confiance.
- **supersede** — contradiction, et les preuves soutiennent la nouvelle affirmation ; on *remplace* la croyance en place.
- **reject** — contradiction, mais les preuves ne la soutiennent pas ; on conserve la croyance en place.

Le magasin est une application partielle d'une clé vers *un seul* contenu. Il n'y a pas d'ajout. Cela donne une propriété que nous pouvons énoncer comme un théorème et démontrer : **à chaque étape, le magasin contient au plus un contenu par clé, et un fait remplacé a disparu — il n'est pas simplement relégué.** Un magasin RAG en ajout seul peut faire ressurgir un fait périmé au moment de la récupération ; Evermind en est structurellement incapable, car le contenu périmé n'existe plus. Par construction, le taux de contradiction est nul.

Le rappel passe par un **cache à jeton de version** : la clé de cache intègre un compteur de version global, que toute opération `supersede`/`augment` incrémente. Un seul incrément invalide *tous* les rappels en cache en `O(1)` — sans balayage entrée par entrée. Les lectures sont donc toujours à jour.

## Le rappel : une recherche hybride

Lorsque le modèle puise dans sa mémoire, il fusionne deux classements — la similarité cosinus dense sur des embeddings normalisés et un score lexical BM25 — par fusion des rangs réciproques (`k = 60`), puis diversifie le haut de la liste par pertinence marginale maximale (`λ = 0.7`). Le résultat est un top-K strictement plafonné (5 par défaut), au contenu tronqué : la mémoire *réduit* ainsi la taille du prompt au lieu de la gonfler.

![Rappel hybride : classements dense (cosinus) et creux (BM25) combinés par fusion des rangs réciproques et diversifiés par MMR](/blog/evermind-hybrid-recall.svg)

## La couche limbique

La plus petite des trois : une cellule récurrente à portes qui transforme un embedding d'expérience et un état affectif en une variation d'affect bornée et une estimation de récompense. La mise à jour est un intégrateur à fuite — une porte apprise décide de la part d'affect antérieur qui persiste et de la part d'expérience nouvelle qui est admise. **La personnalité est encodée sous forme de points de consigne fixes ; la cellule limbique fournit la dynamique autour d'eux.** Elle est entraînée avec un simple objectif MSE sur des cibles `(Δaffect, reward)` observées.

## Routage et distillation en ligne

Une requête arrive d'abord sur un routeur qui privilégie l'option la moins chère. Aucune passerelle vers un modèle de pointe n'est configurée ? La requête est servie par le SSM embarqué. Sinon, le routeur ne passe à l'échelon supérieur que lorsqu'un test syntaxique peu coûteux (mots-clés de complexité, longueur de l'entrée) ou, en dernier recours, une sonde de perplexité indique que le modèle embarqué est dépassé. Lorsqu'il escalade, la réponse du modèle de pointe n'est pas simplement renvoyée — elle devient un **signal d'enseignant** : le cortex s'en sert pour se distiller via WSLA, avec un filtre qui ignore les motifs déjà appris. La boucle se referme sur l'appareil, et les poids adaptés sont persistés dans un checkpoint.

## Ce qui est prouvé, ce qui est construit, et ce qui reste une hypothèse

C'est la partie que la plupart des articles d'architecture passent sous silence, et celle qui compte le plus pour quiconque évalue les affirmations.

**Prouvé et implémenté.** Les trois familles de noyaux SSM, la différentiation automatique et l'optimiseur, l'opérateur de réconciliation avec son invariant de titulaire unique et son invalidation en `O(1)`, le rappel hybride, la cellule limbique, le routeur, la boucle de distillation, le pipeline d'export (safetensors / ONNX / GGUF / Hugging Face — ONNX vérifié à une parité de logits inférieure à `1e-5` par rapport à la passe avant de référence) et le **banc de mesure** sont tous construits et testés.

**Mesuré, pas seulement affirmé.** La question « ce modèle est-il bon ? » n'est plus renvoyée à un futur protocole. Un banc de mesure est livré avec le moteur et s'exécute sur l'appareil dans le Studio : il met de côté une partie du corpus sur laquelle le modèle ne s'entraîne jamais, puis rapporte la perplexité sur ces données réservées, les bits par token, la précision top-1 et top-k sur le token suivant, ainsi que le débit de génération — et il peut comparer deux checkpoints en A/B, de sorte qu'une adaptation doit *prouver* qu'elle fait mieux que la précédente. Chaque modèle entraîné dans le Studio reçoit ce bulletin avant de pouvoir être publié.

**Encore une hypothèse.** Ce que ce banc ne fait pas encore, c'est mener la *comparaison* à grande échelle. Les affirmations comparatives — qu'Evermind surpasse un modèle de pointe figé en *fraîcheur*, qu'il soutient une génération interactive pour une fraction de l'empreinte mémoire, que la distillation WSLA progresse sans oubli catastrophique — sont présentées dans le rapport comme des **hypothèses réfutables assorties d'un protocole de mesure**, et non comme des victoires sur des benchmarks. L'instrument existe désormais et il est ouvert ; le faire tourner face à une référence figée est la prochaine étape, et tant que ces chiffres ne sont pas là, nous continuons à parler d'hypothèses. La contribution honnête, aujourd'hui, c'est la formalisation, l'implémentation ouverte, et les moyens de la mesurer.

Nous pensons que c'est la bonne manière de publier une affirmation de recherche : la rendre précise, la rendre ouverte, et la rendre facile à réfuter.

---

*Evermind repose sur la famille de packages open source `builderforce-memory` (engine / runtime / MCP). Le rapport technique complet — avec chaque équation rattachée à son fichier source, les preuves intégrales et le protocole d'évaluation — est disponible sur demande.*

[Découvrir Evermind →](/evermind) · [Lire la version courte →](/blog/evermind-self-updating-model) · [Commencer à créer gratuitement →](/register)
