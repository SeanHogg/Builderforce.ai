Die meisten KI-Fine-Tuning-Workflows sehen gleich aus: Daten zu einem Cloud-Anbieter hochladen, eine teure A100-Instanz hochfahren, auf das Ende des Trainings warten, die Gewichte herunterladen. Builderforce wirft dieses Drehbuch komplett über Bord.

So führen wir LoRA-Training direkt in Ihrem Browser-Tab mit WebGPU-Compute-Shadern aus.

![LoRA-Zerlegung: die eingefrorenen Basisgewichte W₀ plus das Produkt zweier kleiner trainierbarer Adaptermatrizen B und A ergibt die angepassten Gewichte W – mit Kennzahlenkarten für ~10.000× weniger trainierbare Parameter, bis zu 2B Parameter im Browser und null Cloud-GPU-Kosten](/blog/webgpu-lora.svg)

## Hintergrund: Was ist LoRA?

**LoRA** (Low-Rank Adaptation) ist eine parametereffiziente Fine-Tuning-Technik, die 2021 von Hu et al. vorgestellt wurde. Statt alle Gewichte eines großen Sprachmodells zu aktualisieren, friert LoRA die ursprünglichen Gewichte ein und fügt in jede Attention-Schicht kleine **Adaptermatrizen** ein.

Formal addiert LoRA für eine Gewichtsmatrix `W₀ ∈ ℝᵐˣⁿ` Folgendes:

```
W = W₀ + BA
```

wobei `B ∈ ℝᵐˣʳ` und `A ∈ ℝʳˣⁿ` mit Rang `r ≪ min(m, n)`.

Das Training von nur `B` und `A` reduziert die trainierbaren Parameter bei einem 7B-Modell mit Rang 8 um das 10.000-Fache – und macht Training im Browser machbar.

## Warum WebGPU?

WebGPU ist der moderne Nachfolger von WebGL, speziell für GPU-Compute entworfen. Anders als WebGL, das um die Rasterisierungs-Pipeline herum geformt war, stellt WebGPU über WGSL rohe Compute-Shader bereit – perfekt für die Matrixmultiplikationen, die das Training neuronaler Netze dominieren.

Wichtige Vorteile gegenüber einem CPU-Fallback:
- **Parallele Matrixoperationen** – Tausende Shader-Threads laufen gleichzeitig
- **Shared Memory** – kachelbasiertes GEMM mit On-Chip-Caching
- **Kein Daten-Egress** – Gewichte verlassen Ihren Rechner nie

## Die Builderforce-Trainingspipeline

```
Dataset (JSONL) → Tokeniser → Batching → Forward Pass → Loss → Backward Pass → Weight Update → Repeat
```

Jeder Schritt läuft als WebGPU-Compute-Pipeline:

1. **Tokenisierung** – läuft auf der CPU über den WASM-Tokenizer von Transformers.js
2. **Forward Pass** – Attention- und Feed-Forward-Schichten werden an GPU-Shader übergeben
3. **Loss-Berechnung** – Kreuzentropie über der Vokabularverteilung
4. **Backward Pass** – Gradienten werden per Reverse-Mode-Autodiff in WGSL berechnet
5. **AdamW-Update** – LoRA-Adaptergewichte `A` und `B` werden mit Momentum aktualisiert

## SharedArrayBuffer & COOP/COEP

WebGPU benötigt `SharedArrayBuffer`, um Tensordaten ohne Kopieren zwischen CPU und GPU zu übertragen. Diese API ist hinter Cross-Origin-Isolation-Headern verriegelt:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

Builderforce setzt diese Header auf jeder Seite und aktiviert damit `SharedArrayBuffer`, erlaubt aber weiterhin Cross-Origin-Schriften und -Bilder.

## Datenschutzgarantien

Weil das Training vollständig in Ihrem Browser stattfindet:

- Ihre Trainingsdaten **verlassen Ihren Rechner nie**
- Ihre Modellgewichte **berühren unsere Server nie** (es sei denn, Sie veröffentlichen ausdrücklich)
- Wir können Ihre Fine-Tuning-Daten weder sehen noch protokollieren noch monetarisieren

Die LoRA-Adaptergewichte werden aus GPU-Buffern serialisiert und können als `.safetensors`-Datei heruntergeladen oder unter Ihrem Konto in Cloudflare R2 abgelegt werden.

## Einschränkungen

Training im Browser hat durchaus Grenzen:

| Faktor | Browser-Limit | Cloud-Äquivalent |
|--------|--------------|-----------------|
| Modellgröße | ~2B Parameter | Unbegrenzt |
| VRAM | Mit dem Betriebssystem geteilt (~8 GB) | 40–80 GB |
| Trainingsgeschwindigkeit | ~50 Tok/s | ~5.000 Tok/s |
| Batch-Größe | 1–4 | 32–256 |

Für größere Modelle oder schnellere Iteration können Sie Ihren Datensatz exportieren und das Training auf jeder gängigen Plattform fortsetzen – Builderforce geht Ihnen dabei nicht im Weg.

## Fazit

WebGPU-LoRA-Fine-Tuning im Browser ist keine Spielerei – es ist ein praktischer Weg, kleine Modelle für bestimmte Aufgaben zu personalisieren, ganz ohne Cloud-Infrastruktur oder Datenschutzbedenken. Probieren Sie es in [Ihrem nächsten Projekt](/dashboard) aus!
