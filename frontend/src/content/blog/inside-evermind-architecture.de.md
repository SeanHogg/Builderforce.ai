Die Kurzfassung, [warum es Evermind gibt](/blog/evermind-self-updating-model), haben wir bereits veröffentlicht: Eingefrorene Modelle veralten in dem Moment, in dem sie ausgeliefert werden, und ein seitlich angeflanschter RAG-Store verlagert das Veralten nur an eine andere Stelle. Dies ist die Langfassung – die tatsächliche Architektur, die Gleichungen dahinter und eine bewusst ehrliche Darstellung dessen, was wir *bewiesen*, was wir *gebaut* haben und was noch eine *Hypothese* ist.

Der Beitrag begleitet einen vollständigen technischen Bericht, der für ein Peer-Review verfasst wurde. Wer die Behandlung auf Dissertationsniveau möchte, bei der jede Gleichung auf ihre Quelldatei verweist, findet sie dort. Dieser Beitrag ist die geführte Tour.

## Die These, präzise formuliert

Evermind macht **Aktualität** statt Größe zur primären Designachse. Die Wette lautet nicht „ein kleines Modell kann ein großes an Parametern übertreffen“ – das kann es nicht, und das behaupten wir auch nicht. Die Wette lautet: Eine Architektur, deren *Wissen per Konstruktion immer aktuell ist*, die *ihre eigene Generierung besitzt* und die *in die Laufzeitumgebung passt, in der die Arbeit stattfindet*, gewinnt auf genau den Achsen, die ein eingefrorenes Frontier-Modell strukturell aufgibt.

Evermind ist das Modell selbst – kein Gedächtnis, das an das LLM eines anderen angeflanscht wird. Es besteht aus drei kooperierenden Schichten, die einer groben neurofunktionalen Zerlegung nachempfunden sind.

![Die dreischichtige Architektur von Evermind: ein selektiver State-Space-Cortex, ein Write-Through-Hippocampus und eine trainierbare limbische Schicht, vorgeschaltet ein Inferenz-Router mit optionaler Frontier-Brücke](/blog/evermind-architecture-full.svg)

- **Cortex** – ein hybrides State-Space-Modell mit geteilten Experten, das Sprache in linearer Zeit erzeugt *und* auf dem Gerät, das es ausliefert, einen Gradientenschritt ausführen kann.
- **Hippocampus** – ein Write-Through-Wissensspeicher, der Überzeugungen beim Schreiben *ersetzt*, statt sie anzuhängen.
- **Limbisch** – eine kleine trainierbare rekurrente Zelle, die den Affekt moduliert.

Alle drei sind differenzierbar. Alle drei laufen auf WebGPU ohne jegliche Laufzeitabhängigkeiten. Nehmen wir sie uns der Reihe nach vor.

## Der Cortex: ein selektiver State-Space-Generator

Der Generator ist kein Attention-Stack, sondern ein selektives State-Space-Modell (SSM) aus der Mamba-Familie. Jeder Kanal hält einen verborgenen Zustand `h_t`, der sich unter einer eingabeabhängigen linearen Rekurrenz entwickelt. Nach einer Zero-Order-Hold-Diskretisierung mit inhaltsselektiver Schrittweite `Δ_t` lautet das Update pro Token schlicht:

```
Ā_t = exp(Δ_t · A)              # state decay (A stored as log(−A) for stability)
B̄_t = (Ā_t − 1) / A · B_t       # input gain
h_t = Ā_t ⊙ h_{t−1} + B̄_t · x_t  # recurrence
y_t = C_t · h_t + D · x_t        # readout
```

Das entscheidende Wort ist **selektiv**: `Δ_t`, `B_t` und `C_t` werden aus dem Token selbst projiziert, die Dynamik hängt also vom Inhalt ab. Genau das verleiht einem SSM Attention-ähnliche Ausdruckskraft bei linearen Kosten.

Innerhalb eines Blocks wird die Eingabe RMS-normalisiert, projiziert, durch eine kausale 1-D-Faltung und ein SiLU-Gate geführt, durch den selektiven Scan geschickt, erneut per `SiLU(z)` gegatet, herunterprojiziert und auf einen Residualstrom addiert. Drei Varianten teilen sich dieses Gerüst: **Mamba-1** (der oben beschriebene S6-Scan), **Mamba-2** (strukturierte State-Space-Dualität – ein skalares `A` pro Head, das eine Matrixmultiplikationsform freilegt) und **Mamba-3** (ein komplexwertiger Zustand mit exponentiell-trapezförmiger Diskretisierung, der oszillierende Moden ermöglicht, die ein reelles diagonales `A` nicht darstellen kann). Optional lassen sich Attention-Schichten in einem hybriden Schema dazwischenschalten.

![Der selektive SSM-Block: RMSNorm, Eingabeprojektion, kausale Faltung, der selektive Scan, gesteuert durch eingabeabhängige (Δ, B, C), ein SiLU-Gate und eine Residualaddition](/blog/evermind-ssm-block.svg)

### Warum es sich parallelisieren lässt

Eine lineare Rekurrenz sieht sequenziell aus, ist es aber nicht. Schreiben Sie jeden Schritt als Paar `(a, b) = (Ā_t, B̄_t·x_t)` und definieren Sie den Operator

```
(a₁, b₁) ∘ (a₂, b₂) = (a₁·a₂,  a₁·b₂ + b₁)
```

Dieser Operator ist **assoziativ** (der technische Bericht beweist das, mit dem neutralen Element `(1, 0)`), und die laufende zweite Komponente des Präfixprodukts ist genau `h_t`. Assoziativität ist der ganze Trick: Jeder assoziative Scan berechnet alle Präfixe in `⌈log₂ L⌉` parallelen Durchläufen. Die Zustände für eine Sequenz der Länge `L` ergeben sich also mit `O(log L)` Span und `O(L)` Arbeit – gegenüber `O(L²)` Arbeit bei dichter Attention.

![Die selektive Rekurrenz, ausgewertet als paralleler assoziativer Präfix-Scan – log L Durchläufe über Paare (a, b)](/blog/evermind-parallel-scan.svg)

### Es trainiert auf dem Gerät, das es ausliefert

Die Engine bringt eine bandbasierte Reverse-Mode-Autograd und einen GPU-AdamW-Optimierer mit, sodass der Cortex Gradientenschritte im Browser ausführen kann. Außerdem nutzen wir **WSLA** (Weight-Selective Layer Adaptation): Online-Updates berühren nur die Zeilen der selektiven Projektion, die entscheiden, wie Inhalt in den Zustand geleitet wird, und frieren den Großteil der Repräsentation ein. Das macht Online-Lernen günstig genug, um es in wenigen Epochen ohne separaten Trainingscluster laufen zu lassen.

## Der Hippocampus: Write-Through Cognition

Jetzt kommt der Teil, der wirklich anders ist. Caching hält *Antworten* frisch; der Hippocampus hält *Wissen* frisch.

Jeder Faktenkandidat durchläuft eine einzige Pipeline: **kanonisieren** zu einem stabilen Subjektschlüssel → die amtierende Überzeugung **abrufen** → Belege **bewerten** → **abgleichen** → **durchschreiben**. Der Abgleich liefert eines von vier Urteilen:

- **augment** – völlig neues Subjekt; wird geschrieben.
- **confirm** – identisch mit der amtierenden Überzeugung; nur die Konfidenz wird aufgefrischt.
- **supersede** – widerspricht, und die Belege stützen die neue Aussage; die amtierende Überzeugung wird *ersetzt*.
- **reject** – widerspricht, aber die Belege stützen es nicht; die amtierende Überzeugung bleibt.

Der Speicher ist eine partielle Abbildung von Schlüssel auf *genau einen* Inhalt. Es gibt kein Anhängen. Daraus folgt eine Eigenschaft, die wir als Theorem formulieren und beweisen können: **Zu jedem Zeitpunkt enthält der Speicher höchstens einen Inhalt pro Schlüssel, und ein ersetzter Fakt ist verschwunden – nicht bloß niedriger eingestuft.** Ein Append-only-RAG-Store kann beim Abruf einen veralteten Fakt wieder hervorholen; Evermind kann das strukturell nicht, weil der veraltete Inhalt nicht mehr existiert. Per Konstruktion liegt die Widerspruchsrate bei null.

Der Abruf läuft über einen **Version-Token-Cache**: Der Cache-Schlüssel enthält einen globalen Versionszähler, und jedes `supersede`/`augment` erhöht ihn. Ein einziges Inkrement invalidiert *jeden* zwischengespeicherten Abruf in `O(1)` – ohne Durchlauf pro Eintrag. Lesezugriffe sind damit immer aktuell.

## Abruf: hybrides Retrieval

Wenn das Modell ins Gedächtnis greift, fusioniert es zwei Ranker – dichte Kosinus-Ähnlichkeit über normalisierte Embeddings und einen lexikalischen BM25-Score – per Reciprocal Rank Fusion (`k = 60`) und diversifiziert anschließend die Spitze der Liste mit Maximal Marginal Relevance (`λ = 0.7`). Das Ergebnis ist ein hart begrenztes Top-K (Standard: 5) mit gekürztem Inhalt – das Gedächtnis *verkleinert* also den Prompt, statt ihn aufzublähen.

![Hybrider Abruf: dichte Kosinus- und dünnbesetzte BM25-Rankings, fusioniert per Reciprocal Rank Fusion und diversifiziert per MMR](/blog/evermind-hybrid-recall.svg)

## Die limbische Schicht

Die kleinste der drei: eine gegatete rekurrente Zelle, die ein Erfahrungs-Embedding und einen affektiven Zustand auf ein begrenztes Affekt-Delta und eine Belohnungsschätzung abbildet. Das Update ist ein Leaky Integrator – ein gelerntes Gate entscheidet, wie viel vorheriger Affekt bestehen bleibt und wie viel neue Erfahrung zugelassen wird. **Persönlichkeit ist als feste Sollwerte kodiert; die limbische Zelle liefert die Dynamik um sie herum.** Trainiert wird sie mit einem einfachen MSE-Ziel auf beobachteten `(Δaffect, reward)`-Zielwerten.

## Routing und Online-Destillation

Eine Anfrage trifft zuerst auf einen Router, der die günstigste Option bevorzugt. Keine Frontier-Brücke konfiguriert? Dann bedient das SSM auf dem Gerät. Andernfalls eskaliert der Router nur, wenn ein günstiger syntaktischer Test (Komplexitäts-Schlüsselwörter, Eingabelänge) oder – als letzte Instanz – eine Perplexitätsprobe anzeigt, dass das Modell auf dem Gerät überfordert ist. Eskaliert er, wird die Frontier-Antwort nicht einfach zurückgegeben – sie wird zum **Lehrersignal**: Der Cortex destilliert darauf mit WSLA, wobei ein Gate Muster überspringt, die er bereits gelernt hat. Die Schleife schließt sich auf dem Gerät, und die angepassten Gewichte werden in einem Checkpoint gespeichert.

## Was bewiesen ist, was gebaut ist und was noch Hypothese ist

Diesen Teil lassen die meisten Architektur-Beiträge weg – dabei ist er für jeden, der die Behauptungen bewerten will, der wichtigste.

**Bewiesen und implementiert.** Die drei SSM-Kernel-Familien, Autograd und Optimierer, der Abgleichsoperator mit seiner Single-Incumbent-Invariante und `O(1)`-Invalidierung, der hybride Abruf, die limbische Zelle, der Router, die Destillationsschleife, die Export-Pipeline (safetensors / ONNX / GGUF / Hugging Face – ONNX verifiziert mit einer Logit-Parität unter `1e-5` gegenüber dem Referenz-Forward-Pass) sowie das **Benchmarking-Harness** sind gebaut und getestet.

**Gemessen, nicht nur behauptet.** Die Frage „Wie gut ist dieses Modell?“ wird nicht länger auf ein künftiges Protokoll vertagt. In der Engine steckt ein Benchmarking-Harness, das auf dem Gerät im Studio läuft: Es hält einen Teil des Korpus zurück, auf dem das Modell nie trainiert, und meldet dann Held-out-Perplexität, Bits pro Token, Top-1- und Top-k-Genauigkeit bei der Next-Token-Vorhersage sowie den Generierungsdurchsatz – und kann zwei Checkpoints per A/B-Vergleich gegeneinander antreten lassen, sodass eine Anpassung *beweisen* muss, dass sie besser ist als die vorige. Jedes im Studio trainierte Modell erhält diese Bewertung, bevor es veröffentlicht werden kann.

**Noch Hypothese.** Was dieses Harness noch nicht leistet, ist der *Vergleich* im großen Maßstab. Die vergleichenden Behauptungen – dass Evermind ein eingefrorenes Frontier-Modell bei der *Aktualität* schlägt, dass es interaktive Generierung mit einem Bruchteil des Speicherbedarfs aufrechterhält, dass WSLA-Destillation Verbesserungen ohne katastrophales Vergessen bringt – sind im Bericht als **falsifizierbare Hypothesen mit Messprotokoll** formuliert, nicht als Benchmark-Siege. Das Instrument existiert jetzt und ist offen; es im direkten Vergleich gegen eine eingefrorene Baseline laufen zu lassen, ist der nächste Meilenstein, und bis diese Zahlen vorliegen, nennen wir sie weiterhin Hypothesen. Der ehrliche Beitrag von heute sind die Formalisierung, die offene Implementierung und die Mittel, sie zu messen.

Wir halten das für den richtigen Weg, eine Forschungsbehauptung auszuliefern: präzise formulieren, offenlegen und leicht falsifizierbar machen.

---

*Evermind basiert auf der offenen Paketfamilie `builderforce-memory` (Engine / Runtime / MCP). Der vollständige technische Bericht – mit jeder Gleichung samt Verweis auf ihre Quelldatei, den vollständigen Beweisen und dem Evaluationsprotokoll – ist auf Anfrage erhältlich.*

[Evermind entdecken →](/evermind) · [Die Kurzfassung lesen →](/blog/evermind-self-updating-model) · [Kostenlos loslegen →](/register)
