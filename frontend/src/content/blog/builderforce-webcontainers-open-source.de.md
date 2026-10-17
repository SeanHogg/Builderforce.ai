Jede App, die Sie auf einem Builderforce-Canvas bauen, läuft zuerst in Ihrem Browser, bevor sie irgendwo anders läuft. Bis zu diesem Monat gehörte uns das, was sie dort ausführte, nicht.

Wir haben StackBlitz WebContainers (`@webcontainer/api`) verwendet. Das ist beeindruckende Technik, und es war der richtige Start. Sie brachte aber vier Einschränkungen mit, die umso schwerer wogen, je mehr der Canvas konnte:

- **Eine proprietäre Lizenz.** Die kostenlose Stufe ist nicht kommerziell und verlangt Namensnennung. Eine Runtime unter einem kommerziellen Produkt braucht eine kommerzielle Vereinbarung, und jeder Kunde, der selbst hosten wollte, erbte diese Frage.
- **Cross-Origin-Isolation.** Die Host-Seite muss mit den Headern COOP und COEP ausgeliefert werden. Genau diese Header machen kaputt, was eine echte App einbettet: Anmelde-Popups, Zahlungs-Frames, Videoplayer, Analytics und jedes Drittanbieter-Skript, das nicht die passenden Header zurückschickt.
- **Session-Limits.** 25.000 API-Sessions pro Monat in der kostenlosen Stufe. Ein Canvas, der jedes Mal eine Vorschau öffnet, wenn jemand eine App ansieht, verbraucht Sessions schnell.
- **Kein Zugang.** Wenn eine Vorschau in der Runtime kaputtging, konnten wir es melden und warten. Den Code lesen, reparieren oder forken konnten wir nicht.

Also haben wir unsere eigene gebaut, und ab heute ist sie Open Source unter MIT-Lizenz: **BuilderForce WebContainers**, auf [GitHub](https://github.com/SeanHogg/builderforce-webcontainers) und auf npm als [`@seanhogg/builderforce-webcontainers`](https://www.npmjs.com/package/@seanhogg/builderforce-webcontainers).

## Was Sie jetzt damit machen können

Geben Sie ihr ein Projekt als Dateien, und sie liefert eine Live-Vorschau in einem iframe, mit TypeScript, JSX, CSS, JSON und npm-Paketen, die so funktionieren wie unter Vite. Alles läuft im Browser der Nutzerin oder des Nutzers.

- **Frontend-Apps in der Vorschau.** Vite mit React, Vue oder Svelte, Create React App und statische Websites. Änderungen laden jede offene Vorschau des Projekts neu; es gibt nichts neu zu starten.
- **Für das Deployment in der Seite bauen.** `runtime.build()` ist `npm run build` ohne Server. Es liefert eine gebündelte, minifizierte, inhaltsgehashte statische Website, die Sie überall hochladen können.
- **Typprüfung in der Seite.** `createChecker()` führt TypeScript in einem Web Worker über die tsconfig des Projekts aus und liefert Diagnosen als einfache Daten.
- **Node-Programme ausführen.** `npm install` aus der echten npm-Registry, Node-Skripte, Server im Express-Stil auf virtuellen Ports und eine interaktive `bfsh`-Shell für ein Terminal. Jeder Prozess bekommt seinen eigenen Web Worker, eine Endlosschleife friert die Seite also nie ein, und `kill()` funktioniert immer.
- **Nicht vertrauenswürdigen Code isolieren.** Im Relay-Modus laufen Vorschauen und Prozesse auf einem eigenen Origin, sodass KI-geschriebener Code und beliebige npm-Pakete nie die Cookies oder den Speicher Ihrer App teilen.
- **Forken.** Compiler, Paket-CDN und Transport sind Ports. Tauschen Sie esbuild gegen SWC oder esm.sh gegen Ihren eigenen Mirror, ohne den Kern zu patchen.

```bf-figure
{
  "kind": "compare",
  "title": "Die beiden Runtimes im Vergleich",
  "columns": [
    { "title": "StackBlitz WebContainers", "hue": "muted", "items": ["Proprietäre Lizenz; kostenlose Stufe nicht kommerziell", "25.000 API-Sessions pro Monat in der kostenlosen Stufe", "Verlangt COOP und COEP auf der Host-Seite", "Fester Compiler und feste Paketquelle", "Build und Typprüfung über npm run build und tsc im Container", "Node, npm und eine Shell"] },
    { "title": "BuilderForce WebContainers", "hue": "make", "items": ["MIT: forken, ausliefern, verkaufen", "Kein Session-Limit", "Keine Cross-Origin-Isolation nötig; Einbettungen funktionieren weiter", "Austauschbare Ports für Compiler, Paket-CDN und Transport", "runtime.build() und createChecker() im Browser", "Node, npm und eine Shell, ein Web Worker pro Prozess"] }
  ],
  "caption": "Was unsere braucht: einen sicheren Kontext (https oder localhost) für den Service Worker. Das ist alles."
}
```

## So funktioniert es

Während der Entwicklung wird nichts gebündelt. Die Runtime arbeitet wie der Dev-Server von Vite, nur dass ein Service Worker die Rolle des Netzwerks übernimmt.

```bf-figure
{
  "kind": "flow",
  "title": "Von Dateien zur laufenden Vorschau",
  "steps": [
    { "label": "Einbinden", "note": "Das Projekt lebt in einem virtuellen Dateisystem in der Seite. Eine Datei schreiben heißt bearbeiten; es gibt keine Festplatte.", "hue": "idea" },
    { "label": "Pro Datei kompilieren", "note": "Wenn die Vorschau src/App.tsx anfordert, wird genau diese Datei mit esbuild-wasm kompiliert und als natives ES-Modul ausgeliefert.", "hue": "make" },
    { "label": "Pakete auflösen", "note": "Bare Imports werden zu esm.sh-URLs, festgelegt aus der package.json und dedupliziert, sodass es genau ein React gibt.", "hue": "make" },
    { "label": "Ausliefern", "note": "Ein Service Worker beantwortet die Anfragen des iframes, indem er die Seite fragt, und die Vorschau lädt wie jede Website.", "hue": "run", "tag": "im Tab" }
  ],
  "caption": "Der Start ist sofort da, und eine Änderung kompiliert eine Datei neu. Browser beenden untätige Service Worker; passiert das, bittet der Worker offene Seiten, sich neu zu verbinden, statt die Anfrage scheitern zu lassen."
}
```

Node-Programme nehmen einen anderen Weg. `runtime.run('node', …)` startet einen Web Worker mit einem Snapshot der Dateien und Shims für `fs`, `http`, `child_process` und die übrigen Kernmodule von Node; Schreibvorgänge werden mit allen anderen Prozessen synchronisiert. Ein Server, der `listen(3000)` aufruft, wird über denselben Service Worker beantwortet, und `onServerListening` übergibt dem Host seine URL. Jeder Prozess kommt als `RuntimeProcess` zurück: ein kombinierter Ausgabestream, `stdin`, `wait()` für den Exit-Code, `kill()` und `resizeTerminal()`.

## Was sie auf Builderforce antreibt

```bf-figure
{
  "kind": "screen",
  "frame": "Eine App auf dem Canvas, ausgeführt von BuilderForce WebContainers",
  "ratio": 1.62,
  "regions": [
    { "label": "Vorschau", "note": "Ausgeliefert von preview.builderforce.ai, getrennt von Ihrer Session", "x": 4, "y": 8, "w": 58, "h": 62, "hue": "make" },
    { "label": "Terminal", "note": "bfsh: npm, npx, node, Pipes", "x": 4, "y": 74, "w": 58, "h": 20, "hue": "run" },
    { "label": "Prüfen", "note": "Typprüfung, Build, Lint, Fehler gehen an den Agenten", "x": 65, "y": 8, "w": 31, "h": 40, "hue": "prove" },
    { "label": "Veröffentlichen", "note": "runtime.build() zu einer statischen Website unter Ihrer Adresse", "x": 65, "y": 52, "w": 31, "h": 42, "hue": "accent" }
  ],
  "caption": "Eine Runtime hinter allen vieren. Nichts davon verlangt vom Browser Cross-Origin-Isolation, die App in der Vorschau verhält sich also wie die App, die Sie ausliefern."
}
```

- **Canvas-Vorschauen.** Die App-Ansicht und Studio führen jedes Projekt im Relay-Modus damit aus: Die Vorschau lebt auf `preview.builderforce.ai`, einem eigenen Origin, sodass von einem Agenten geschriebener Code nie Ihre Builderforce-Cookies oder Ihren Speicher berührt.
- **Veröffentlichen.** Veröffentlichen baut die Website in Ihrem Browser aus den Projektdateien und lädt das statische Ergebnis auf Ihre Subdomain hoch. Die Vorschau und alles, was darin eingebunden ist, bleibt unberührt.
- **Prüfen.** Prüfen führt Typprüfung und Build direkt auf den Dateien aus, ohne Installation, und danach das projekteigene `npm run lint` auf der Node-Runtime, falls es eines gibt. Jeder fehlgeschlagene Schritt geht als Aufgabe zurück an den Agenten.
- **Fehler.** Nicht abgefangene Fehler in der Vorschau werden an die Host-Seite gemeldet. So erreicht eine kaputte App den Assistenten, der sie geschrieben hat, statt fertig auszusehen und liegen zu bleiben.

## Was sie noch nicht kann

Wir sagen es lieber selbst, als dass Sie es herausfinden:

- **Native Addons und Installationsskripte.** `.node`-Addons können in keinem Browser laden, und `postinstall` wird übersprungen. Pakete mit WebAssembly-Fallback (esbuild-wasm, @swc/wasm) funktionieren; Pakete, die nur native Binärdateien liefern (sharp, better-sqlite3), nicht.
- **Die Dev-Server von Next.js, Nuxt, SvelteKit, Remix und Astro.** Sie brauchen heute native Binärdateien. Die Runtime erkennt diese Projekte und lehnt sie mit Begründung ab, damit der Host auf eine andere Runtime ausweichen kann, statt eine kaputte Vorschau zu zeigen.
- **WebSockets und Streaming-Antworten** von einem Server innerhalb der Runtime. Antworten werden vorerst vollständig gepuffert.
- **`execSync` und `spawnSync`.** Einen Worker auf einen anderen warten zu lassen, würde Cross-Origin-Isolation erfordern, und die verlangt diese Runtime grundsätzlich nicht.

Jeder dieser Punkte steht auf der öffentlichen [Roadmap](https://github.com/SeanHogg/builderforce-webcontainers/blob/main/ROADMAP.md), ungefähr in der Reihenfolge, in der sich ihre Lösung lohnt.

## Schnellstart

Liefern Sie den Service Worker aus dem Paket unter `/__bfwc/sw.js` aus, dann starten, einbinden, anzeigen:

```ts
import { startPreviewRuntime } from '@seanhogg/builderforce-webcontainers';

const runtime = await startPreviewRuntime({ serviceWorkerUrl: '/__bfwc/sw.js', id: 'my-project' });
runtime.writeTree({
  'package.json': JSON.stringify({ dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' } }),
  'index.html': '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
  'src/main.tsx': `import { createRoot } from 'react-dom/client';
createRoot(document.getElementById('root')!).render(<h1>Hello</h1>);`,
});

if (runtime.profile().supported) iframe.src = runtime.url;
runtime.onError((e) => console.warn('preview crashed:', e.message));

// Ship it: a static site with hashed assets, built in the page.
const { files } = await runtime.build({ base: './' });
```

Wenn der Code in der Vorschau von einer KI stammt oder beliebige Pakete einbindet, liefern Sie die Relay-Dateien von einem eigenen Origin aus und übergeben `relayUrl` statt `serviceWorkerUrl`. Die [README](https://github.com/SeanHogg/builderforce-webcontainers#readme) beschreibt den Relay-Modus, die Typprüfung, Vue und Svelte sowie die Node-Runtime.

Jede Vorschau zeigt ein kleines „Built with Builderforce.ai“-Abzeichen. Es ist keine Lizenzbedingung, und `attribution: false` schaltet es ab. Wenn Ihnen die Runtime Geld spart, finanziert das eingeschaltete Abzeichen das Projekt.

## Wo es in der Methode steht

Arbeit auf Builderforce folgt einem Bogen, **Idea → Make → Run → Measure**, und jeder Akt durchläuft dieselbe innere Schleife: [Read, Prove, Build](/blog/read-prove-build-the-inner-loop).

```bf-figure
{
  "kind": "flow",
  "title": "Eine Runtime, drei Akte des Bogens",
  "steps": [
    { "label": "Make", "note": "Die Vorschau im Tab: Eine Änderung kompiliert eine Datei neu, und jede offene Vorschau lädt neu.", "hue": "make" },
    { "label": "Prüfen", "note": "Typprüfung, Build und Lint, bevor etwas ausgeliefert wird, mit Fehlern zurück an den Agenten.", "hue": "prove" },
    { "label": "Run", "note": "Veröffentlichen baut im Browser und stellt eine statische Website unter Ihre Adresse.", "hue": "run" },
    { "label": "Measure", "note": "Vorschaufehler werden an die Seite gemeldet, der erste Beleg kommt also vor der ersten Nutzerin.", "hue": "measure" }
  ],
  "caption": "Die Runtime zu starten kostet nichts, und genau das hält Prove günstig: Ein laufender Prototyp sind ein paar Sekunden im Tab, kein Container."
}
```

Die Runtime lebt in **Make**, und sie verändert, wie sich **Prove** anfühlt. Eine Idee mit einem laufenden Prototyp zu belegen hieß früher, auf einen Container oder ein Deployment zu warten. Jetzt startet der Prototyp im Tab, kostet im Betrieb nichts und hat keinen Session-Zähler, sodass die zweite Idee so billig auszuprobieren ist wie die erste.

**Build** bekommt ein Tor. Prüfen führt dieselbe Typprüfung und denselben Build aus wie Veröffentlichen, der Schritt von **Make** zu **Run** ist also ein Ergebnis, das Sie lesen können, keine Hoffnung.

Und weil die Runtime unter MIT steht, ist nichts davon eine Abhängigkeit, in die Sie nicht hineinsehen können. Wenn sich eine Vorschau seltsam verhält, liegt der Code, der sie ausgeführt hat, auf GitHub.

## Was Sie heute damit tun können

- **Bauen Sie eine App auf dem Canvas** und sehen Sie zu, wie sie im Tab läuft, ohne Header zu konfigurieren und ohne Installation.
- **Betten Sie die Runtime in Ihr eigenes Produkt ein.** Ein Paket, ein Service Worker, MIT.
- **Node im Tab ausführen.** `runtime.run('npm', ['install'])`, dann `node server.js`; `onServerListening` liefert die URL für den Frame.
- **Lesen Sie die Roadmap und schicken Sie einen Pull Request.** Als Nächstes: Lint im Prüf-Worker, Hot Module Replacement und Style-Präprozessoren.

---

**Weiterlesen:** [Open Source bei Builderforce](/blog/open-source-at-builderforce) · [Die App auf Ihrem Canvas ist jetzt ein echtes Projekt](/blog/your-canvas-app-is-a-real-project) · [Die IDE im Browser](/blog/in-browser-ide-and-collaboration)

[Alles sehen, was wir als Open Source veröffentlichen](/open-source) oder [die Seite der Runtime lesen](/open-source/builderforce-webcontainers).
