Die Teile von Builderforce, die auf Ihrem Rechner oder in Ihrem Browser laufen, sind genau die Teile, die Sie lesen können sollten. Sie berühren Ihre Dateien, Ihre Schlüssel, Ihre Modelle und die Sessions Ihrer Nutzer. „Vertrauen Sie uns“ ist darauf eine schlechte Antwort; die bessere Antwort ist der Quellcode.

Deshalb sind die Runtimes, auf denen Builderforce aufbaut, Open Source unter MIT-Lizenz. Es sind vier, und jede davon ist das, was das Produkt tatsächlich ausführt, keine herausgeschnittene Demo. Die beiden Bibliotheken brauchen überhaupt kein Konto; die beiden Desktop-Apps melden sich für die Teile, die in der Cloud leben, bei Builderforce an. Alle vier finden Sie unter [builderforce.ai/open-source](/open-source).

```bf-figure
{
  "kind": "stack",
  "title": "Vier Projekte, darüber eine Plattform",
  "bands": [
    { "label": "BuilderForce WebContainers", "note": "Eine Entwicklungs-Runtime im Browser: Vorschau, Build, Typprüfung, Node, npm und eine Shell, ohne COOP/COEP und ohne Session-Limits.", "hue": "make", "tag": "TypeScript · npm" },
    { "label": "BuilderForce Memory", "note": "Persistentes, im Browser trainierbares SSM-Gedächtnis für jeden Agenten, ein semantischer Cache, der Token-Kosten senkt, und ein MCP-Server.", "hue": "idea", "tag": "TypeScript · npm" },
    { "label": "BuilderForce Inference", "note": "Synapse, die Desktop-App, und bfi, eine native Engine, die Modelle auf Ihrem eigenen Rechner ausführt.", "hue": "run", "tag": "Rust" },
    { "label": "BuilderForce Spawn", "note": "Roblox-Spiele per Gespräch bauen: eine Desktop-App und eine Brücke zu Roblox Studio.", "hue": "reach", "tag": "Rust" }
  ],
  "caption": "Alle vier stehen unter MIT. Die Bibliotheken brauchen kein Konto; die Desktop-Apps melden sich für die Cloud-Teile an."
}
```

## BuilderForce WebContainers – die Runtime unter jeder Vorschau

**Was es ist.** Eine offene, forkbare Entwicklungs-Runtime im Browser. Geben Sie ihr ein Projekt als Dateien, und sie liefert eine Live-Vorschau: Vite mit React, Vue oder Svelte, Create React App und statische Websites. Sie baut für das Deployment (`runtime.build()`) und prüft Typen (`createChecker()`) in der Seite und führt Node-Programme, `npm install` aus der echten Registry und eine interaktive Shell aus, ein Web Worker pro Prozess.

**Was es wert ist.** Sie braucht einen sicheren Kontext und einen Service Worker, sonst nichts. Ohne COOP/COEP-Header funktionieren Anmelde-Popups, Zahlungs-Frames und Einbettungen in Ihrer App weiter. Ohne Session-Limits kostet das Öffnen einer Vorschau nichts. Mit austauschbaren Ports können Sie Compiler oder Paket-CDN wechseln, ohne den Kern zu forken. Sie hat StackBlitz WebContainers unter jeder Canvas-Vorschau, jedem Veröffentlichen und jedem Prüfen auf Builderforce abgelöst.

**Klar über die Grenzen.** Native Addons, Installationsskripte und die Dev-Server von Next.js, Nuxt, SvelteKit, Remix und Astro laufen nicht; die Runtime erkennt solche Projekte und sagt warum. WebSockets und Streaming-Antworten stehen auf der Roadmap.

[Projektseite lesen](/open-source/builderforce-webcontainers) · [Ankündigung lesen](/blog/builderforce-webcontainers-open-source) · [GitHub](https://github.com/SeanHogg/builderforce-webcontainers)

## BuilderForce Memory – ein Gedächtnis, das jeder Agent behalten kann

**Was es ist.** Ein Framework, das jedem KI-Agenten ein persistentes, im Browser trainierbares Gedächtnis gibt. Drei Pakete: eine Engine aus WebGPU-Mamba-State-Space-Kernels mit Trainer und Tokenizer (`@seanhogg/builderforce-memory-engine`); eine Runtime mit Bridges für Anthropic, OpenAI und Fetch, einem Inferenz-Router, Online-Destillation und dem Gedächtnisspeicher (`@seanhogg/builderforce-memory`); und ein MCP-Server mit einem Installer, der ihn in Claude Code, Claude Desktop, Cursor, Windsurf, VS Code, Cline, Gemini CLI und Codex CLI registriert (`@seanhogg/builderforce-memory-mcp`).

**Was es wert ist.** Niedrigere Token-Rechnungen und Wissen, das aktuell bleibt. Ein semantischer Cache verwendet eine Antwort erneut, wenn ein neuer Prompt eine bereits beantwortete Frage nur umformuliert; das Frontier-Modell wird gar nicht erst aufgerufen. Write-Through-Kognition ersetzt eine veraltete Tatsache, wenn eine neuere durch Belege gestützt ist, statt beide anzuhäufen, bis jemand sie abgleicht. Es ist die Gedächtnisschicht von Evermind auf Builderforce und anbieterneutral, also unter einem Agenten, der nie von uns gehört hat, genauso nützlich.

[Projektseite lesen](/open-source/builderforce-memory) · [GitHub](https://github.com/SeanHogg/builderforce-memory)

## BuilderForce Inference – Modelle auf Ihrem eigenen Rechner

**Was es ist.** Synapse, die Desktop-App von Builderforce, und die lokale KI-Runtime darunter. `bfi` ist eine native, in Rust geschriebene Engine, die GGUF-Modelle liest, OpenAI-, Anthropic- und Ollama-kompatible HTTP-APIs bereitstellt und auf Ihrer Hardware läuft. Synapse überwacht sie, Ollama wird also nicht gebraucht. Im selben Workspace stecken ein Code-Index, ein MCP-Host für Konnektoren, ein Evermind-Gedächtnis-Client und Secrets im Anmeldeinformationsspeicher des Betriebssystems.

**Was es wert ist.** Private Arbeit bleibt privat. Lokale Modelle antworten Ihrem Editor und Ihren Skripten ohne Netzwerkaufruf, und was Evermind auf Ihrem Rechner lernt, bleibt dort, solange Sie es nicht veröffentlichen. Der CPU-Pfad ist heute verfügbar; GPU-Gleichstand mit llama.cpp haben wir nicht behauptet, und die README sagt das auch.

[Projektseite lesen](/open-source/builderforce-inference) · [GitHub](https://github.com/SeanHogg/builderforce-inference)

## BuilderForce Spawn – Roblox-Spiele per Gespräch

**Was es ist.** Spawn, eine Desktop-App für Roblox-Creator, und die Brücke, die sie mit Roblox Studio verbindet. Beschreiben Sie das Spiel, und Spawn baut die Teile, das Luau und die Oberfläche in Studio. Die Anmeldung bei Builderforce läuft über den gemeinsamen Client aus BuilderForce Inference.

**Was es wert ist.** Eine einzige Installation statt App, Plugin, lokalem Server und Sync-Tool. Und weil es offen ist, können Eltern, Schulen und Creator, die genau wissen wollen, was ein Baukasten für junge Creator tut, es nachlesen.

[Projektseite lesen](/open-source/builderforce-spawn) · [GitHub](https://github.com/SeanHogg/builderforce-spawn)

## Eigenständig oder auf Builderforce

```bf-figure
{
  "kind": "compare",
  "title": "Derselbe Code, zwei Arten, ihn zu nutzen",
  "columns": [
    { "title": "Eigenständig", "hue": "muted", "items": ["Aus npm oder cargo installieren oder von GitHub klonen", "MIT: forken, ausliefern, verkaufen", "Jede Zeile lesen, die auf Ihrer Seite läuft", "Selbst hosten, das Ergebnis gehört Ihnen"] },
    { "title": "Auf Builderforce", "hue": "make", "items": ["Bereits an Canvas, Studio, Brain und Desktop-App angebunden", "Agenten, Boards, Freigaben und der Marketplace obendrauf", "Gedächtnis, geteilt zwischen Ihrer Web-App, Ihren Agenten und Ihrem Rechner", "In einem Schritt unter Ihrer eigenen Adresse veröffentlichen"] }
  ],
  "caption": "Open Source ist hier keine Testversion. Der Code auf GitHub ist der Code, den das Produkt ausführt."
}
```

## Wo es in der Methode steht

Arbeit auf Builderforce folgt einem Bogen, **Idea → Make → Run → Measure**, und jeder Akt durchläuft dieselbe innere Schleife: [Read, Prove, Build](/blog/read-prove-build-the-inner-loop). Jedes Projekt trägt einen anderen Teil davon.

- **Make** läuft auf BuilderForce WebContainers. Eine Idee wird im Tab zur laufenden App, und **Prove** bleibt kostenlos, weil ein Prototyp nichts kostet, um zu starten.
- **Run** erreicht mit BuilderForce Inference Ihren Rechner. Ein lokal ausgeführtes Modell antwortet ohne Zähler, einen Agenten laufen zu lassen ist also eine Frage der Zeit, nicht des Geldes.
- **Measure** speist BuilderForce Memory. Was funktioniert hat, wird behalten, eine wiederholte Frage wird aus dem Gedächtnis beantwortet, und die nächste **Idea** beginnt mit dem, was die letzte gelehrt hat.
- **Make** für Spiele ist Spawn: dieselbe Schleife, in Roblox Studio.

Open Source ändert die Methode nicht. Es ändert, wer die Arbeit prüfen kann: Jeder Akt, der auf Ihrer Seite läuft, führt Code aus, den Sie lesen können.

## So fangen Sie an

- Stöbern Sie in allen vier unter [builderforce.ai/open-source](/open-source).
- Betten Sie die Runtime ein: `npm install @seanhogg/builderforce-webcontainers`.
- Geben Sie Ihrem Agenten ein Gedächtnis: `npm install @seanhogg/builderforce-memory`, oder installieren Sie den MCP-Server in die Tools, die Sie schon nutzen.
- Führen Sie Modelle lokal aus: `cargo install --git https://github.com/SeanHogg/builderforce-inference bfi`.
- Eröffnen Sie ein Issue oder schicken Sie einen Pull Request. Jedes Repository führt eine Roadmap mit den nächsten Schritten.

---

**Weiterlesen:** [BuilderForce WebContainers ist Open Source](/blog/builderforce-webcontainers-open-source) · [Synapse führt Modelle jetzt selbst aus](/blog/synapse-runs-models-itself) · [Spawn – Roblox-Spiele per Gespräch bauen](/blog/build-roblox-games-by-talking)

[Öffnen Sie einen Canvas](/create) und sehen Sie die Runtime bei der Arbeit.
