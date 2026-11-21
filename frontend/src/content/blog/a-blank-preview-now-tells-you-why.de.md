# Eine leere Vorschau sagt Ihnen jetzt, warum, und eine Laravel-API startet im Tab

Sie drücken Run. Der Vorschaurahmen bleibt weiß. Oder er füllt sich, aber es dauert zwölf Sekunden, und Sie wissen nicht, ob es am Netzwerk lag, am Compiler, an einem Paket-CDN oder an Ihrem eigenen Code.

Bisher gab Ihnen die Runtime im Browser dafür kaum Anhaltspunkte. Die Vorschau läuft unter einer strengen Sicherheitsrichtlinie, also wird eine Karte, die Kacheln von einem fremden Server lädt, oder eine Schrift von einem CDN blockiert, und die Seite sieht einfach kaputt aus. Ein langsamer erster Ladevorgang sah genauso aus wie ein schneller, der hängen geblieben war. Und wenn Ihre API Laravel war, scheiterte `php artisan serve`, bevor es eine einzige Anfrage beantwortet hatte.

BuilderForce WebContainers 2026.11.9 schließt diese Lücken. **Eine leere oder langsame Vorschau kommt jetzt mit einem Grund, und eine Laravel-API startet jetzt im Tab.**

## Ein Aufruf, der zeigt, wohin die Zeit ging

`runtime.diagnostics()` gibt einen einzigen Ladebericht zurück. Er enthält nur, was die Runtime gemessen hat:

- **Phasenzeiten** für den Start der Runtime, die Bereitschaft des Service Workers, das Laden des Compilers und das erste Rendern der Vorschau.
- **Verkehr zum Paket-CDN:** wie viele Anfragen, wie lange sie insgesamt dauerten und wie viele fehlschlugen.
- **Anfragen pro Origin** und die **langsamsten Anfragen**, beschriftet nach Origin und danach, was sie angefordert hat. Pfade und URLs werden weggelassen.
- Die **jüngsten Verstöße gegen die Sicherheitsrichtlinie** in der Vorschau.
- Ob der Browser-Cache **kalt oder warm** war.
- Eine Liste dessen, was **nicht gemessen werden konnte**, damit eine fehlende Zahl nicht für eine Null gehalten wird.

```bf-figure
{
  "kind": "flow",
  "title": "Die vier Phasen, die ein Ladebericht misst",
  "steps": [
    { "label": "Start der Runtime", "note": "Die Uhr läuft ab dem Start der Runtime. Jede andere Phase wird von hier aus gemessen.", "hue": "make" },
    { "label": "Service Worker bereit", "note": "Der Worker, der die Dateien der Vorschau ausliefert, ist installiert und antwortet.", "hue": "make" },
    { "label": "Compiler geladen", "note": "Der esbuild-Compiler in WebAssembly wird heruntergeladen und gestartet. Ein kalter Cache zeigt sich hier zuerst.", "hue": "run" },
    { "label": "Erstes Rendern der Vorschau", "note": "Die Vorschau meldet ihr erstes inhaltliches Rendern. In diesem Moment sieht ein Mensch etwas.", "hue": "measure" }
  ],
  "caption": "Jede Phase trägt eine Startzeit und eine Dauer. Eine Phase, die der Browser nicht beobachten konnte, wird als nicht verfügbar geführt statt als null gemeldet."
}
```

Wenn also jemand sagt, die Vorschau sei langsam, sehen Sie, ob der Download des Compilers die meiste Zeit gekostet hat, das Paket-CDN, oder ob der Cache einfach kalt war.

## Sehen, was die Sicherheitsrichtlinie genau blockiert hat

Vorschauen führen Code aus, den Sie nicht geschrieben haben, deshalb gibt die Runtime jeder eine strenge Content Security Policy. Das ist die richtige Voreinstellung, und es ist zugleich der häufigste Grund, warum eine Vorschau leer oder halb gestylt erscheint.

`runtime.onCspViolation(listener)` sagt der Host-Seite jetzt, welcher Origin unter welcher Direktive blockiert wurde: zum Beispiel blockierte `img-src` den Origin `https://tile.openstreetmap.org`. Eine blockierte Adresse wird auf ihren Origin gekürzt, sodass kein Pfad und keine Query die Vorschau verlässt. Wiederholungen werden einmal gemeldet, und die Gesamtzahl ist begrenzt, sodass eine Seite in einer Schleife Sie nicht überfluten kann.

```bf-figure
{
  "kind": "screen",
  "frame": "Ihre Seite, mit eingebetteter Runtime",
  "ratio": 1.6,
  "regions": [
    { "label": "Vorschau", "note": "Eine Karten-App ohne Kacheln: Die Richtlinie hat den Kachelserver blockiert", "x": 4, "y": 8, "w": 58, "h": 84, "hue": "muted", "style": "ghost" },
    { "label": "Blockiert: img-src", "note": "https://tile.openstreetmap.org", "x": 66, "y": 8, "w": 30, "h": 24, "hue": "bad" },
    { "label": "Ladebericht", "note": "Phasen, CDN-Anfragen, langsamste Origins, kalter oder warmer Cache", "x": 66, "y": 36, "w": 30, "h": 34, "hue": "measure" },
    { "label": "Lösung", "note": "Den Origin zur Liste der erlaubten Ziele der Vorschau hinzufügen", "x": 66, "y": 74, "w": 30, "h": 18, "hue": "good" }
  ],
  "caption": "Der leere Rahmen ist kein Rätsel mehr. Der Verstoß nennt Origin und Direktive, und die Lösung ist eine Zeile Konfiguration."
}
```

Sie bringen eine bestehende App unter die Richtlinie? `previewCspMode: 'report-only'` meldet jeden Verstoß, ohne etwas zu blockieren, sodass Sie zuerst die vollständige Liste sammeln können. Es schaltet den Schutz ab, ist also nur für Migrationen gedacht, und Ihr Server muss es bewusst zulassen. Builderforce schaltet es nie ein.

## Ihr eigenes Paket-CDN, ohne leere Seite

Wenn Sie npm-Pakete von einem eigenen Mirror statt von esm.sh ausliefern, deklariert der Mirror jetzt seine Origins, und die Runtime fügt sie für Sie zur Richtlinie der Vorschau hinzu. Ein esm.sh-kompatibler Mirror braucht eine Option:

```ts
const runtime = await startPreviewRuntime({
  relayUrl: 'https://preview.example.com/__bfwc/relay.html',
  cdn: createEsmShCdnFactory({ origin: 'https://esm.example.com' }),
});
```

Ein eigenes CDN ohne deklarierte Origins scheiterte früher still: Jeder Paketimport wurde blockiert, und die Vorschau blieb leer. Jetzt protokolliert die Runtime eine Warnung, die das Problem benennt, einmal.

```bf-figure
{
  "kind": "compare",
  "title": "Eine leere Vorschau, vorher und nachher",
  "columns": [
    { "title": "Vor 2026.11.9", "hue": "muted", "items": ["Ein weißer Rahmen und kein Grund", "Blockierte Origins nur auf Ihrem Server sichtbar, falls Sie Berichte sammelten", "Ein langsamer Ladevorgang sah aus wie ein hängender", "Ein eigenes CDN ohne gelisteten Origin brach still", "php artisan serve scheiterte beim Start"] },
    { "title": "Mit 2026.11.9", "hue": "run", "items": ["Der blockierte Origin und die Direktive, auf der Host-Seite", "Ein Ladebericht: Phasen, CDN, Origins, Cache", "Report-only-Modus, um eine App unter die Richtlinie zu bringen", "Die Origins eines eigenen CDN kommen in die Richtlinie, oder Sie erhalten eine Warnung", "Eine Laravel-API startet mit php artisan serve"] }
  ],
  "caption": "Die Richtlinie ist so streng wie zuvor. Neu ist, dass sie sich erklärt."
}
```

## Eine Laravel-API startet jetzt im Tab

`php artisan serve` startet den eingebauten Webserver von PHP als eigenen Prozess. Der WebAssembly-Build von PHP, der im Browser läuft, kann auf diese Weise keine Prozesse starten, also scheiterte Laravels eigener Serve-Befehl, bevor die API irgendetwas beantwortete. Die Runtime liefert ihn jetzt direkt aus, so wie Laravel es tun würde, aus dem Verzeichnis `public/` der App.

Damit starten ein Vite-Frontend, eine Laravel-API und eine Postgres-Datenbank durchgängig in einem Tab: Composer installiert die Pakete, die Migrationen laufen, die API startet, und das Frontend erreicht sie über dieselbe Adresse.

```bf-figure
{
  "kind": "flow",
  "title": "Eine App aus Vite, Laravel und Postgres startet in einem Tab",
  "steps": [
    { "label": "Postgres", "note": "Eine echte Postgres-Datenbank, in der Seite gehalten.", "hue": "measure", "tag": "im Tab" },
    { "label": "composer install", "note": "Installiert die Pakete der API. Seine Ausgabe endet mit ihrer letzten Zeile, bevor der nächste Schritt startet.", "hue": "make", "tag": "Setup" },
    { "label": "artisan migrate", "note": "Legt das Schema an, sobald Pakete und Datenbank bereit sind.", "hue": "make", "tag": "Setup" },
    { "label": "artisan serve", "note": "Die Laravel-API, bereit, wenn ihre Health-Route antwortet.", "hue": "run", "tag": "im Tab" },
    { "label": "Vite-Frontend", "note": "Die Seite, durch die Sie klicken, und die die API unter /api aufruft.", "hue": "run", "tag": "im Tab" }
  ],
  "caption": "Setup-Schritte sind ebenfalls Dienste: Jeder endet, bevor die Dienste starten, die von ihm abhängen, und sein vollständiges Log liegt dann vor."
}
```

Die Setup-Schritte haben noch eine Korrektur bekommen. Wenn `composer install` oder `npm install` fertig ist, endet sein Log jetzt immer mit seiner letzten Zeile, bevor der nächste Dienst seinen Zustand ändert. Scheitert ein Schritt, steht der Fehler, den Sie brauchen, im Log und ist nicht knapp darüber abgeschnitten.

## Kleinere Dinge, die das Hosting erleichtern

- **Das .NET-Runtime-Bundle lässt sich aus npm installieren** als `@seanhogg/builderforce-webcontainers-dotnet`, in derselben Version wie die Runtime. Kopieren Sie es in Ihre statischen Dateien und richten Sie die Runtime darauf aus.
- **Eine Tabelle aller zur Laufzeit geladenen Assets.** Das README listet jetzt jeden Origin, von dem die Runtime herunterlädt, welche Seite oder welcher Worker ihn abruft, wann, und wie Sie ihn selbst hosten. Hat Ihre Website eine strenge Richtlinie oder kein Netzwerk, sehen Sie genau, was zu spiegeln ist.

## Wo es in der Methode sitzt

Idea to Real ist ein Bogen, **Idea → Make → Run → Measure**, mit einer Schleife darin: [Read, Prove, Build](/blog/read-prove-build-the-inner-loop). Lesen und Beweisen kosten nichts, also ist die Entscheidung zu bauen eine echte Entscheidung.

Ein Beweis hilft nur, wenn seine Antwort klar ist. Führen Sie einen Smoke-Test oder einen Proof of Concept aus und bekommen eine leere Seite, können Sie nicht sagen, ob die Idee gescheitert ist oder die Infrastruktur. Ein Ladebericht und ein benannter blockierter Origin trennen beides: Entweder tut die App, was Sie beschrieben haben, oder Sie wissen, welche Zeile Konfiguration sie aufgehalten hat.

```bf-figure
{
  "kind": "stack",
  "title": "Der Bogen, mit Run und Measure als Rückmeldung",
  "bands": [
    { "label": "Idea", "note": "Lesen Sie sie und wählen Sie den günstigsten Beweis, der sich lohnt: einen Smoke-Test, einen Proof of Concept, einen Pilot.", "hue": "idea" },
    { "label": "Make", "note": "Bauen Sie das eine, das der Beweis verlangt hat, eine Laravel-API eingeschlossen.", "hue": "make" },
    { "label": "Run", "note": "Sehen Sie es im Tab starten. Ist die Vorschau leer, wird der blockierte Origin benannt.", "hue": "run", "tag": "erklärt sich" },
    { "label": "Measure", "note": "Phasenzeiten und Anfragezahlen, sodass ein langsamer Lauf eine Zahl trägt.", "hue": "measure", "tag": "Ladebericht" }
  ],
  "caption": "Ein gescheiterter Beweis sollte eine Erkenntnis über die Idee sein, nicht über die Vorschau."
}
```

## Was Sie heute damit tun können

- **Herausfinden, warum eine Vorschau leer ist**, indem Sie den blockierten Origin und die Direktive lesen, und diesen Origin dann erlauben.
- **Herausfinden, warum eine Vorschau langsam ist**, mit einem Aufruf, der jede Phase misst und den Verkehr zu CDN und Origins zählt.
- **Eine bestehende App unter die Richtlinie bringen** mit dem Report-only-Modus, und danach wieder auf Durchsetzen umschalten.
- **Pakete von Ihrem eigenen Mirror ausliefern**, ohne seinen Origin von Hand zu listen.
- **Eine Laravel-API betreiben** mit Vite-Frontend und Postgres, durchgängig, im Browser-Tab.
- **Die Runtime auf einer abgeschotteten Website hosten**, mit einer Liste von allem, was sie lädt, und dem .NET-Bundle aus npm.

---

**Weiterlesen:** [BuilderForce WebContainers ist Open Source](/blog/builderforce-webcontainers-open-source) · [Ihre Full-Stack-App läuft jetzt in dem Browser-Tab, in dem Sie sie gebaut haben](/blog/your-full-stack-app-now-runs-in-your-browser-tab) · [Read, Prove, Build: die innere Schleife](/blog/read-prove-build-the-inner-loop)

[Lesen Sie die Runtime auf GitHub](https://github.com/SeanHogg/builderforce-webcontainers), oder [öffnen Sie ein Canvas](/create), beschreiben Sie eine App mit einer Laravel-API und drücken Sie Run.
