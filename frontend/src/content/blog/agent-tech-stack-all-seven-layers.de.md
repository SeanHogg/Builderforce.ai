Jeder Erklärtext zum „AI Agent Tech Stack“ zeichnet dasselbe Bild: sieben Schichten, jede mit einer Aufgabe, jede eine Stelle, an der der Agent brechen kann. Das Foundation Model bekommt die Schlagzeilen – doch die sechs Schichten darunter entscheiden, ob das Ganze in Produktion tatsächlich funktioniert.

Der Haken an der kanonischen Version dieses Diagramms: Sie ist eine *Einkaufsliste*. Einen Modellanbieter wählen. LangGraph anflanschen. Eine Memory-Bibliothek ergänzen. Eine Vektordatenbank aufsetzen. Tools verdrahten. Ein Observability-SaaS kaufen. Containerisieren und deployen. Sieben Schichten, sieben Anbieter, sieben Fehlerquellen – und jede Menge Glue Code, der die Nahtstellen zusammenhält.

Builderforce.ai besteht aus denselben sieben Schichten – gebaut als **eine Plattform**. Dieser Beitrag geht jede Schicht durch, ordnet ihr zu, was Builderforce.ai tatsächlich betreibt, und sagt offen, welche zwei Schichten wir gerade gehärtet haben, um von „vorhanden“ zu „übertroffen“ zu kommen.

![Der siebenschichtige Agent-Stack, durchgängig umgesetzt von Builderforce.ai](/blog/agent-stack-seven-layers.svg)

## Die Bilanz

| # | Schicht | Das Referenzdesign | Builderforce.ai |
|---|-------|----------------------|-----------------|
| 1 | Foundation Model | Einen Anbieter wählen | Unterstütztes Multi-Vendor-Gateway, Routing + Fallback |
| 2 | Orchestrierung | LangGraph-ReAct-Loop | Nativer ReAct-Loop + Multi-Agent-Orchestrator (Rollen, DAG, Retries) |
| 3 | Memory | Eine Bibliothek für Arbeits- + episodisches Gedächtnis | Alle vier Gedächtnistypen, SSM-nativ, Write-Through Cognition |
| 4 | Vektor-DB & RAG | Pinecone/Chroma + Embeddings | **Chunking + hybrid (dense+BM25) + Rerank** über LanceDB oder SSM-Store |
| 5 | Tools & Integrationen | `@tool` + MCP | Capability-gesteuerte Registry, MCP-Server, Browser, 10+ Kanäle |
| 6 | Observability & Evaluation | LangSmith/Langfuse | Tracing + Kostenmessung **+ Faithfulness/Halluzination + Drift** |
| 7 | Deployment | Docker + eine Queue | Cloudflare Workers + Durable Objects + Containers + Docker |

Fünf davon übertrafen das Referenzdesign bereits. Zwei – RAG und Evaluation – waren *gut, aber konventionell dünn*. Wir haben beide Lücken geschlossen. Hier der Rundgang.

## Schicht 1 – Foundation Model

Builderforce.ai behandelt das Modell als **austauschbare, geroutete Ressource** statt als dauerhafte Festlegung. Das OpenAI-kompatible Gateway stellt die im aktuellen Katalog verfügbaren Anbieter bereit und unterstützt konfiguriertes Routing, Fallback, eigene Zugangsdaten (BYO) und Reasoning-Steuerung. Die Verfügbarkeit hängt von Plan, Region, Zugangsdaten und Runtime ab.

**Urteil: übertroffen.** Sie setzen Ihr Produkt nicht auf die Roadmap eines einzelnen Anbieters.

## Schicht 2 – Orchestrierung

Ein einzelner ReAct-Loop (denken → handeln → beobachten) ist die Untergrenze. Builderforce.ai führt diesen Loop nativ aus und setzt einen **Multi-Agent-Orchestrator** darauf: spezialisierte Rollen (Creator, Reviewer, Test-Generator, Bug-Analyzer, …), einen Abhängigkeitsgraphen für Aufgaben, begrenzte Retries mit Selbstheilung und einen dauerhaften Zustand, der einen Prozessneustart übersteht. Derselbe Loop läuft On-Prem und in der Cloud, inklusive eingebautem adversarialem Review-Durchgang.

**Urteil: übertroffen.** Ein koordiniertes Team mit Governance schlägt einen einzelnen Agenten in einer Schleife.

## Schicht 3 – Memory

Der Referenz-Stack liefert meist Arbeits- und episodisches Gedächtnis aus einem Framework. Builderforce.ai bringt **alle vier** mit – Arbeits-, episodisches, semantisches und prozedurales Gedächtnis – und zwar *SSM-nativ*: Wissen wird per Online-Distillation direkt in ein Modell (Evermind) geschrieben, statt nur an einen Speicher angehängt zu werden, mit einem persistenten, sitzungsübergreifenden Faktenspeicher darunter.

**Urteil: übertroffen.** Ein Gedächtnis, das *lernt* – nicht nur eines, das *protokolliert*.

## Schicht 4 – Vektor-DB & RAG  ✦ in diesem Release gehärtet

Hier waren wir ehrlich zu uns selbst. Builderforce.ai hatte Vektor-Retrieval (LanceDB + Embeddings, dazu einen SSM-Embedding-Store ganz ohne API) – aber *nur Kosinus*. Der Lehrbuch-RAG-Stack leistet drei Dinge, die reines Kosinus-Retrieval nicht kann: Er **zerlegt** Dokumente in präzise Passagen, er sucht **hybrid** (dichte Vektoren *und* sparse BM25, sodass exakte Tokens – Bezeichner, Fehlercodes, seltene Namen – nicht verloren gehen), und er **rankt** nach Relevanz und Vielfalt neu.

Also haben wir alle drei in die kanonische Memory-Schicht eingebaut:

![Hybrides Retrieval: dichte und sparse Signale, per RRF fusioniert und per MMR neu gerankt](/blog/hybrid-retrieval.svg)

- **Chunking** – ein rekursiver Zeichen-Splitter mit Überlappung, sodass große Dokumente zu zusammenhängenden Passagen werden.
- **BM25** – lexikalisches Okapi-Scoring parallel zum dichten Vektordurchlauf.
- **Reciprocal Rank Fusion** – führt beide Rankings über den *Rang* zusammen, nicht über unvergleichbare Rohwerte.
- **MMR-Reranking** – wägt Relevanz gegen Neuheit ab, damit die Top-k nicht aus fünf Beinahe-Duplikaten bestehen.

Das Ganze degradiert sauber: kein Embedding-Modell verfügbar → nur BM25; keine lexikalische Überschneidung → nur dicht. Es ist sowohl im SSM-Memory-Store als auch im LanceDB-Pfad für das Langzeitgedächtnis verdrahtet, Chunking greift beim Schreiben.

**Urteil: jetzt übertroffen.** Hybrid + Rerank ist genau der Teil, bis zu dem es die meisten selbstgebauten RAG-Stacks nie schaffen.

## Schicht 5 – Tools & Integrationen

Ein Tool ist eine typisierte Funktion, die das Modell aufrufen kann. Builderforce.ai hat eine **Capability-gesteuerte Tool-Registry** (Tools deklarieren die Fähigkeiten, die sie brauchen; die Runtime filtert sie je Oberfläche – Cloud, Container, On-Prem –, sodass derselbe Tool-Satz überall läuft), einen **MCP-Server**, der Tools für externe IDEs bereitstellt, Browser-Automatisierung mit Playwright, Web-, Such-, Git- und Shell-Tools, 10+ Messaging-Kanäle und ein Plugin-SDK für eigene Tools.

**Urteil: übertroffen.** Ein Tool-Vertrag, jede Oberfläche, keine Handarbeit pro Oberfläche.

## Schicht 6 – Observability & Evaluation  ✦ in diesem Release gehärtet

LLMs scheitern lautlos – auch eine halluzinierte Antwort liefert HTTP 200. Builderforce.ai hat bereits jeden LLM-Aufruf getract, Tokens und Kosten gemessen und Durchläufe nach *Ergebnis* bewertet (wurde der PR gemergt, ist die CI grün, wie viele Schritte, wie viel Budget). Was fehlte, war die Bewertung, ob die Antwort **fundiert und beim Thema** war – die semantischen Evaluationsmetriken, die heute jedes LLM-Observability-Tool mitbringt.

Wir haben sie ergänzt:

![Evaluation und Drift: Faithfulness, Relevanz, Halluzination – plus Regressionsalarme](/blog/evaluation-and-drift.svg)

- **Faithfulness** – ist die Antwort durch ihren Kontext gedeckt?
- **Antwort-/Kontextrelevanz** – beantwortet sie die Frage; war der abgerufene Kontext relevant?
- **Halluzinationsrate** – der Anteil der Antwort, der *nicht* fundiert ist.

Zwei Backends, eine Schnittstelle: Ein **kostenloser lexikalischer Scorer** läuft inline bei jedem Cloud-Durchlauf (kein zusätzlicher LLM-Aufruf), und ein **LLM-as-Judge**-Upgrade steht auf Abruf über `/api/eval` bereit – abgerechnet über dasselbe gemessene Gateway wie jede andere Completion. Die Scores werden am Run-Datensatz gespeichert, und ein **Drift-Monitor** – Mittelwertverschiebung per z-Score plus Population Stability Index – vergleicht ein Basisfenster mit einem aktuellen Fenster je (Aktionstyp × Modell) und schlägt Alarm, wenn die Qualität nachlässt. Er läuft täglich per Cron und auf Abruf über `/api/eval/drift`.

**Urteil: jetzt übertroffen.** Eine stille Qualitätsregression wird zum Alarm – nicht zum grünen Dashboard.

## Schicht 7 – Deployment

Das Referenzdesign ist Docker plus eine synchrone API oder asynchrone Queue. Builderforce.ai läuft auf **Cloudflare Workers + Durable Objects** (ein dauerhafter Agent-Loop, der über Serverless-Timeout-Grenzen hinweg weitertickt) plus **Containers** für Durchläufe mit Shell, mit Docker für die lokale Entwicklung. Caching ist erstklassig – Read-Through (L1 im Isolate + L2 KV), Prompt-Caching und ein semantischer Response-Cache – ergänzt um Kostenobergrenzen und Schrittbudgets pro Mandant.

**Urteil: übertroffen.** Dauerhaft, gecacht, kostengedeckelt und gemanagt.

## Worum es geht

Den gesamten Stack zu verstehen, heißt nicht, sieben Anbieter zusammenzustecken und zu hoffen, dass die Nahtstellen halten. Builderforce.ai sind die sieben Schichten als ein einziges, gesteuertes, beobachtbares System – und nach diesem Release *hat* es nicht nur jede Schicht, es **erreicht oder übertrifft** das Referenzdesign in jeder einzelnen. Die beiden Schichten, die bisher bloß konventionell waren – RAG-Retrieval und semantische Evaluation –, sind jetzt hybrid mit Reranking beziehungsweise mit Faithfulness-Scoring und Drift-Erkennung ausgestattet.

Das ist der Unterschied zwischen einem Stack, den man zeichnet, und einem Stack, den man ausliefert.

> Lust auf den Deep Dive? Werfen Sie einen Blick auf das Modell [Evermind](/evermind) hinter der Memory-Schicht, oder [starten Sie kostenlos](/register).
