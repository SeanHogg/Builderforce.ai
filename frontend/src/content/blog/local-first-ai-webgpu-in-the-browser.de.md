SitePoint hat kürzlich einen hervorragenden Bauplan dafür veröffentlicht, wie man große Sprachmodelle vollständig im Browser betreibt: [*Local-First AI With WebGPU: A Practical Guide for Chrome*](https://www.sitepoint.com/local-first-ai-webgpu-chrome-guide/). Es ist die klarste Darstellung, die wir bisher gesehen haben, *warum* On-Device-Inferenz endlich praxistauglich ist und *was* eine produktionsreife Umsetzung richtig machen muss.

Wir haben ihn so gelesen, wie man eine Checkliste für etwas liest, das man längst ausgeliefert hat. Builderforce betreibt WebGPU-Inferenz – und Training – seit über einem Jahr im Browser-Tab. Dieser Beitrag tut deshalb zweierlei: Er geht die im Artikel empfohlene Architektur durch und zeigt dann genau, wie unsere Plattform jeden Punkt dieser Liste umsetzt – plus die Teile, die der Leitfaden nicht abdeckt.

## Der Bauplan in einem Absatz

Der Leitfaden argumentiert, dass drei Entwicklungen Local-First-KI Wirklichkeit werden ließen: **auf 4 Bit quantisierte kleine Modelle**, **WebGPU als stabile Funktion in Chrome 113** und Chromes **eingebautes Gemini Nano**, verfügbar über die Prompt API. Die empfohlene Architektur verteilt die Arbeit nach Hardware-Stärken – WebGPU-Compute-Shader (WGSL) für den matmul-lastigen Forward Pass, WebAssembly für Tokenisierung und Sampling – hinter einer **Progressive-Enhancement-Kaskade**: Prompt API (Stufe 1) → ein WebGPU-Framework wie Web-LLM (Stufe 2) → Cloud-Fallback (Stufe 3), alles hinter einer einheitlichen Schnittstelle. Danach listet er die betrieblichen Pflichtpunkte auf: Inferenz in einem **Web Worker** ausführen, vorwärmen, um die Time-to-First-Token zu senken, **Gewichte lokal cachen**, sich von **`GPUDevice.lost`** erholen und alles per Feature-Detection prüfen.

Eine großartige Liste. So setzen wir jeden Punkt um.

## 1. Die Compute-Schicht: Wir liefern eigene WGSL-Kernel aus

Der Leitfaden empfiehlt, sich auf ein Framework (Web-LLM, Transformers.js) zu stützen, das die Transformer-Mathematik auf GPU-Workgroups abbildet. Wir sind eine Ebene tiefer gegangen. Die Engine von Builderforce bringt **handgeschriebene WGSL-Kernel** für ein Mamba-**State-Space-Modell** mit – den Selective-Scan-Kern (S6), umgesetzt als paralleler Kogge-Stone-Prefix-Scan, der auf der GPU in O(log N) läuft, mit numerisch stabilem Softplus und Zero-Order-Hold-Diskretisierung.

Entscheidend: Unsere Kernel implementieren den **Backward Pass**, nicht nur den Forward Pass. Wir *betreiben* ein Modell also nicht nur auf dem Gerät – wir **trainieren** es dort, mit echten AdamW-Gradientenschritten auf Ihrem eigenen Code, komplett im Tab. Der SitePoint-Leitfaden endet bei der Inferenz; diese Fähigkeit ist es, die [„Memory-First“-Lernen](/blog/evermind-self-updating-model) und [LoRA-Fine-Tuning im Browser](/blog/webgpu-lora-explained) überhaupt möglich macht.

## 2. Geräteauswahl: WebNN → WebGPU → CPU

Der Artikel behandelt WebGPU als *den* Compute-Pfad. Für uns ist es der mittlere von dreien. Unser Device-Router prüft in dieser Reihenfolge:

1. **WebNN** – die Neural-Network-API, die eine dedizierte **NPU** (Snapdragon X, Apple Neural Engine, Intel AI Boost) ansprechen kann, bevor die GPU überhaupt ins Spiel kommt.
2. **WebGPU** – der leistungsstarke GPU-Pfad, auf den sich der Leitfaden konzentriert.
3. **CPU (WASM SIMD)** – der ehrliche Fallback.

Eine Prüfung, eine Entscheidung, geteilt von allen Konsumenten – keine Komponente berechnet für sich selbst neu, ob dieser Browser das kann. Und wir **erfinden bewusst keinen VRAM-Wert**: WebGPU legt den echten Speicher nicht offen, also melden wir `null`, statt ein 2-GB-Spezifikationslimit mit einer 2-GB-Karte zu verwechseln und fälschlich eine 16-GB-GPU auszusperren.

## 3. Stufe 1: Chromes eingebautes Gemini Nano

Das ist das Kernfeature des Leitfadens – und jetzt ein vollwertiges Backend in Builderforce. Unser `PromptApiModelProvider` kapselt Chromes `LanguageModel`-API: **null Download** für die App (das Modell kommt mit dem Browser), kein VRAM-Budget zu verwalten und **echtes Token-Streaming** ab Werk:

```ts
import { createInferenceProvider } from '@/lib/model-provider';

const ai = createInferenceProvider({
  projectId,
  systemPrompt: 'You are a concise coding assistant.',
});
await ai.init();

// Streams tokens the instant the built-in model produces them.
await ai.stream('Refactor this function', context, (token) => {
  append(token);
});
```

Der Provider erkennt die API per Feature-Detection, verarbeitet die vom Browser gemeldeten Zustände `downloadable`/`downloading`/`available` und macht das verbleibende **Token-Budget** der Session sichtbar (`inputUsage` / `inputQuota`), damit Aufrufer den Verlauf kürzen können, *bevor* das feste Kontextfenster voll ist.

## 4. Die Progressive-Enhancement-Kaskade

Die wichtigste Idee des Leitfadens ist eine architektonische: **eine Schnittstelle, viele Backends, eleganter Fallback**. Genau das liefert `createInferenceProvider` – einen einzigen `ModelProvider`, der intern so priorisiert:

1. **Chrome Prompt API** (lokal, ohne Einrichtung) – wenn der Browser sie anbietet
2. **Ihr On-Device-Modell** (ein trainiertes Mamba-SSM, optional in einem Worker) – wenn Sie eines haben
3. **Cloud-LLM** – immer verfügbar, der letzte Fallback

`init()` wählt das Backend mit der höchsten Priorität, das bereit wird; `generate` und `stream` leiten dorthin und **fallen transparent** auf die nächste bereite Stufe zurück, wenn es einen Fehler wirft. Die Entscheidung „welches Backend?“ lebt an genau einer Stelle. Ihre UI spricht einfach mit einem `ModelProvider` und verzweigt nie selbst nach Verfügbarkeit.

## 5. Isolation im Web Worker

Der Leitfaden hat recht: Die Generierung darf niemals den Main Thread blockieren – Sampling über einen Logit-Vektor mit 150.000 Einträgen *pro Token* bringt die UI ins Stocken. Deshalb kann die gesamte Engine in einem **Web Worker** laufen. Weil sich ein `GPUDevice` nicht über die Worker-Grenze übertragen lässt, hostet der Worker die Engine vollständig, und der Main Thread spricht über ein kleines RPC-Protokoll mit ihr:

```ts
import { createLocalFirstProvider } from '@/lib/mamba-worker-client';

const ai = createLocalFirstProvider({
  projectId,
  includeLocalMamba: true, // Tier 2 runs entirely in a Web Worker
});
await ai.init();
```

Token- und Fortschrittsereignisse pro Epoche kommen als Nachrichten zurück; der trainierte Checkpoint wird nach Hause **übertragen** (nicht kopiert). Und kann die Runtime keinen Worker starten, meldet der Provider „nicht bereit“, und die Kaskade fällt einfach auf die nächste Stufe – nichts geht kaputt.

## 6. Wiederherstellung nach `GPUDevice.lost`

Ein Tab im Hintergrund, ein Treiber-Reset oder ein Laptop, der die GPU wechselt, machen stillschweigend jeden Buffer und jede Pipeline ungültig, die Sie halten. Der Leitfaden weist darauf hin; die meisten Browser-Demos ignorieren es. Builderforce abonniert das Device-Lost-Promise an der einzigen Stelle, an der das Gerät angefordert wird. Ein echter Verlust baut das Modell ab und setzt den Provider zurück auf *nicht bereit*, sodass der nächste Aufruf sauber neu initialisiert – während ein bewusstes `destroy()` herausgefiltert wird und nie als Fehler erscheint.

## 7. Gewichte cachen, Downloads streamen, Privatsphäre wahren

Modellgewichte werden nach dem ersten Download in **IndexedDB** zwischengespeichert, bezogen über eine Kette mehrerer Quellen (unser R2-Proxy → Hugging Face CDN) mit Streaming-Fortschritt – ein Checkpoint von mehreren Gigabyte wird also einmal geladen, nicht bei jedem Seitenaufruf. Und die Datenschutz-Eigenschaft, die der Leitfaden als „architektonische Tatsache“ beschreibt, ist genau der Grund, warum wir das gebaut haben: Mit lokaler Inferenz **verlassen Ihre Prompts und Ihr Code niemals die Maschine**. Das ist kein Versprechen in einer Richtlinie; die Netzwerkanfrage findet schlicht nicht statt.

## Bilanz: die Checkliste des Leitfadens vs. Builderforce

| Best Practice aus dem Leitfaden | Builderforce |
| --- | --- |
| WebGPU-Compute-Shader | ✅ Handgeschriebene WGSL-Kernel für Mamba-SSM |
| Tokenisierung/Sampling in WASM | ✅ BPE-Tokenizer, trainiert auf Ihrem eigenen Korpus |
| Chrome Prompt API (Stufe 1) | ✅ `PromptApiModelProvider`, echtes Streaming |
| Web-LLM / WebGPU (Stufe 2) | ✅ On-Device-Mamba, optional in einem Worker |
| Cloud-Fallback (Stufe 3) | ✅ Letzte Stufe der Kaskade |
| Einheitliche Schnittstelle + Fallback | ✅ `createInferenceProvider` |
| Isolation im Web Worker | ✅ Komplette Engine in einem Worker |
| Wiederherstellung nach `GPUDevice.lost` | ✅ Behandlung von Geräteverlust an einer einzigen Stelle |
| Lokales Caching der Gewichte | ✅ IndexedDB, Streaming, mehrere Quellen |
| Alles per Feature-Detection prüfen | ✅ Prüfkette WebNN → WebGPU → CPU |
| **On-Device-*Training*** | ✅ **Über den Leitfaden hinaus** – echter Backward Pass + AdamW |
| **NPU über WebNN** | ✅ **Über den Leitfaden hinaus** |
| **Semantischer Antwort-Cache** | ✅ **Über den Leitfaden hinaus** – On-Device-SSM-Embeddings |

## So nutzen Sie es

Alles oben Beschriebene ist heute verfügbar:

- **Chat- und Assistenzoberflächen** rufen `createInferenceProvider({ projectId })` auf und erhalten die Local-First-Kaskade gratis dazu – Gemini Nano, wenn der Browser es hat, sonst die Cloud, eine Zeile Code.
- **Datenschutzsensible Arbeit** aktiviert `includeLocalMamba`, damit die Inferenz vollständig auf dem Gerät in einem Web Worker bleibt.
- **Fine-Tuning** findet im [AI-Training-Panel](/training) statt: Richten Sie es auf Ihren Code, und echter WebGPU-Gradientenabstieg erzeugt einen Checkpoint, der nie einen Server berührt.

Der SitePoint-Leitfaden ist die richtige Landkarte. Builderforce ist eine Plattform, die das gesamte Gelände bereits durchschritten hat – und weitergegangen ist, bis ins On-Device-Training, das der Browser bis vor Kurzem eigentlich nie beherrschen sollte.

*Sie möchten die technische Tiefe? Lesen Sie [Inside the Evermind Architecture](/blog/inside-evermind-architecture) und [WebGPU LoRA Fine-Tuning Explained](/blog/webgpu-lora-explained).*
